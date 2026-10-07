"""Durable computation queue, execution journal and per-case hash-linked audit log."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
    event,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


def now() -> datetime:
    return datetime.now(UTC)


def uid() -> str:
    return str(uuid4())


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class Base(DeclarativeBase):
    pass


class CaseRecord(Base):
    __tablename__ = "cases"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    external_id: Mapped[str | None] = mapped_column(String(128), unique=True)
    origin: Mapped[str] = mapped_column(String(16), default="manual")
    data: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), default="open", index=True)
    latest_run_id: Mapped[str | None] = mapped_column(String(36))
    audit_seq: Mapped[int] = mapped_column(Integer, default=0)
    audit_hash: Mapped[str] = mapped_column(String(64), default="0" * 64)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RunRecord(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    case_version: Mapped[int] = mapped_column(Integer)
    input_snapshot: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    execute_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    result: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String(500))
    lease_owner: Mapped[str | None] = mapped_column(String(36))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ReviewRecord(Base):
    __tablename__ = "reviews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), unique=True)
    action: Mapped[str] = mapped_column(String(32))
    note: Mapped[str] = mapped_column(String(4000))
    actor: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ExecutionRecord(Base):
    __tablename__ = "executions"
    __table_args__ = (UniqueConstraint("run_id", "mode", name="uq_execution_run_mode"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    mode: Mapped[str] = mapped_column(String(16))
    action: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(24), default="in_flight")
    response: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookRecord(Base):
    __tablename__ = "webhooks"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    event: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    lease_owner: Mapped[str | None] = mapped_column(String(36))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class PolicyRecord(Base):
    __tablename__ = "policies"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    document: Mapped[dict] = mapped_column(JSON)
    sha256: Mapped[str] = mapped_column(String(64))
    actor: Mapped[str] = mapped_column(String(32), default="reviewer")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditRecord(Base):
    __tablename__ = "audit_events"
    __table_args__ = (UniqueConstraint("case_id", "sequence", name="uq_audit_case_sequence"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("cases.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(64))
    actor: Mapped[str] = mapped_column(String(32))
    data: Mapped[dict] = mapped_column(JSON)
    timestamp: Mapped[str] = mapped_column(String(40))
    previous_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class Database:
    def __init__(self, url: str):
        options: dict[str, Any] = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            options["connect_args"] = {"check_same_thread": False, "timeout": 30}
        self.engine = create_engine(url, **options)
        if url.startswith("sqlite"):

            @event.listens_for(self.engine, "connect")
            def sqlite_setup(connection, _record):
                connection.execute("PRAGMA foreign_keys=ON")
                connection.execute("PRAGMA journal_mode=WAL")

        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def initialize(self) -> None:
        Base.metadata.create_all(self.engine)

    def close(self) -> None:
        self.engine.dispose()


def audit(session: Session, case: CaseRecord, kind: str, data: dict, actor="system") -> None:
    """Caller holds the case row lock; journal and business update commit together."""
    timestamp = now().isoformat()
    sequence = case.audit_seq + 1
    body = {
        "case_id": case.id,
        "sequence": sequence,
        "kind": kind,
        "actor": actor,
        "data": data,
        "timestamp": timestamp,
        "previous_hash": case.audit_hash,
    }
    digest = hashlib.sha256(canonical(body).encode()).hexdigest()
    session.add(AuditRecord(**body, hash=digest))
    case.audit_seq = sequence
    case.audit_hash = digest
    case.updated_at = now()


def audit_entries(session: Session, case_id: str) -> list[dict]:
    rows = session.scalars(
        select(AuditRecord).where(AuditRecord.case_id == case_id).order_by(AuditRecord.sequence)
    )
    return [
        {
            "case_id": r.case_id,
            "sequence": r.sequence,
            "kind": r.kind,
            "actor": r.actor,
            "data": r.data,
            "timestamp": r.timestamp,
            "previous_hash": r.previous_hash,
            "hash": r.hash,
        }
        for r in rows
    ]


def verify_chain(entries: list[dict], expected_head: str, expected_count: int) -> bool:
    previous = "0" * 64
    for sequence, entry in enumerate(entries, 1):
        body = {key: value for key, value in entry.items() if key != "hash"}
        if entry["sequence"] != sequence or entry["previous_hash"] != previous:
            return False
        previous = hashlib.sha256(canonical(body).encode()).hexdigest()
        if previous != entry["hash"]:
            return False
    return len(entries) == expected_count and previous == expected_head
