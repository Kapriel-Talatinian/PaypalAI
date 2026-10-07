"""Authenticated HTTP contracts for integrations and the human-review dashboard."""

import hmac
import logging
import time
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, OperationalError

from . import __version__
from .config import Settings
from .db import (
    CaseRecord,
    Database,
    ExecutionRecord,
    ReviewRecord,
    RunRecord,
    WebhookRecord,
    audit_entries,
    verify_chain,
)
from .domain import (
    CaseInput,
    CasePage,
    CaseView,
    EvidenceUpdate,
    EvidenceVerificationInput,
    ExecutionInput,
    ExecutionView,
    ImportPayPalInput,
    PolicyDocument,
    ProofGraph,
    ReconcileInput,
    ReviewInput,
    ReviewView,
    RunRequest,
    RunView,
)
from .paypal import PayPalError
from .policy import PolicyError, PolicyNotFound
from .service import Coordinator, ServiceError, record_dict

logger = logging.getLogger(__name__)


def coordinator(request: Request) -> Coordinator:
    return request.app.state.coordinator


def authenticate(
    request: Request, key: Annotated[str | None, Header(alias="X-API-Key", max_length=1024)] = None
) -> str:
    settings = request.app.state.coordinator.settings
    if key:
        if settings.reviewer_api_key and hmac.compare_digest(
            key.encode(), settings.reviewer_api_key.get_secret_value().encode()
        ):
            return "reviewer"
        if hmac.compare_digest(key.encode(), settings.api_key.get_secret_value().encode()):
            return "service"
    raise ServiceError(401, "A valid X-API-Key is required")


def require_reviewer(request: Request, role: Annotated[str, Depends(authenticate)]) -> str:
    settings = request.app.state.coordinator.settings
    if role == "reviewer" or (
        not settings.reviewer_api_key and settings.environment != "production"
    ):
        return "reviewer"
    raise ServiceError(403, "This operation requires the reviewer API key")


Backend = Annotated[Coordinator, Depends(coordinator)]


def create_app(
    settings: Settings | None = None,
    *,
    database: Database | None = None,
    extractor=None,
    paypal=None,
) -> FastAPI:
    settings = settings or Settings()
    db = database or Database(settings.database_url)
    backend = Coordinator(settings, db, extractor=extractor, paypal=paypal)

    @asynccontextmanager
    async def lifespan(app):
        if settings.environment != "production":
            db.initialize()
        try:
            yield
        finally:
            await backend.close()
            db.close()

    app = FastAPI(
        title="DisputeFlow API",
        version=__version__,
        lifespan=lifespan,
        description="Auditable neuro-symbolic PayPal dispute handling with a human-review dashboard.",
    )
    app.state.coordinator = backend
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST"],
            allow_headers=["Content-Type", "X-API-Key", "Idempotency-Key"],
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid4())
        started = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request=%s method=%s path=%s status=%d duration_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            (time.monotonic() - started) * 1000,
        )
        return response

    @app.exception_handler(ServiceError)
    async def service_error(_request, error: ServiceError):
        return JSONResponse(status_code=error.status, content={"detail": error.detail})

    @app.exception_handler(PolicyNotFound)
    async def missing_policy(_request, _error):
        return JSONResponse(status_code=404, content={"detail": "Policy not found"})

    @app.exception_handler(PolicyError)
    async def invalid_policy(_request, error):
        return JSONResponse(status_code=422, content={"detail": str(error)})

    @app.exception_handler(PayPalError)
    async def paypal_error(_request, error: PayPalError):
        status = error.status_code if error.status_code in {409, 422, 503} else 502
        return JSONResponse(
            status_code=status,
            content={"detail": error.message, "code": error.code, "debug_id": error.debug_id},
        )

    @app.exception_handler(IntegrityError)
    async def conflict(_request, _error):
        return JSONResponse(
            status_code=409,
            content={
                "detail": "Concurrent update conflicts with an existing record; refresh and retry"
            },
        )

    @app.exception_handler(OperationalError)
    async def unavailable(_request, _error):
        return JSONResponse(status_code=503, content={"detail": "Database temporarily unavailable"})

    @app.get("/health", tags=["operations"])
    def health():
        return {"status": "ok", "version": __version__}

    @app.get("/ready", tags=["operations"])
    def ready():
        with db.sessions() as session:
            session.execute(text("SELECT 1"))
            session.scalar(select(func.count()).select_from(RunRecord))
        backend.reload_policies()
        return {
            "status": "ready",
            "execution_mode": settings.execution_mode,
            "llm_provider": settings.llm_provider,
        }

    router = APIRouter(prefix="/v1", dependencies=[Depends(authenticate)])

    @router.post("/disputes", status_code=201, response_model=CaseView, tags=["disputes"])
    def create_dispute(body: CaseInput, service: Backend):
        return service.create_case(body)

    @router.get("/disputes", response_model=CasePage, tags=["disputes"])
    def list_disputes(
        service: Backend,
        offset: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=200),
        status: str | None = Query(None, max_length=32),
    ):
        with service.db.sessions() as session:
            query = select(CaseRecord)
            if status:
                query = query.where(CaseRecord.status == status)
            total = session.scalar(select(func.count()).select_from(query.subquery()))
            rows = session.scalars(
                query.order_by(CaseRecord.updated_at.desc(), CaseRecord.id)
                .offset(offset)
                .limit(limit)
            )
            return {
                "items": [record_dict(row) for row in rows],
                "total": total,
                "offset": offset,
                "limit": limit,
            }

    @router.get("/disputes/{case_id}", response_model=CaseView, tags=["disputes"])
    def get_dispute(case_id: str, service: Backend):
        with service.db.sessions() as session:
            case = service._case(session, case_id)
            result = record_dict(case)
            run = session.get(RunRecord, case.latest_run_id) if case.latest_run_id else None
            result["latest_run"] = record_dict(run) if run else None
            return result

    @router.post("/disputes/{case_id}/evidence", response_model=CaseView, tags=["disputes"])
    def update_evidence(case_id: str, body: EvidenceUpdate, service: Backend):
        return service.update_evidence(case_id, body)

    @router.post(
        "/disputes/{case_id}/evidence/{evidence_id}/verify",
        tags=["governance"],
        response_model=CaseView,
        dependencies=[Depends(require_reviewer)],
    )
    def verify_evidence(
        case_id: str, evidence_id: str, body: EvidenceVerificationInput, service: Backend
    ):
        return service.verify_evidence(case_id, evidence_id, body)

    @router.post(
        "/disputes/{case_id}/runs", status_code=202, response_model=RunView, tags=["analysis"]
    )
    def run_dispute(case_id: str, body: RunRequest, service: Backend):
        return service.enqueue(case_id, execute=body.execute)

    @router.get("/runs/{run_id}", response_model=RunView, tags=["analysis"])
    def get_run(run_id: str, service: Backend):
        with service.db.sessions() as session:
            return record_dict(service._run(session, run_id))

    @router.get("/runs/{run_id}/proof", response_model=ProofGraph, tags=["analysis"])
    def get_proof(run_id: str, service: Backend):
        with service.db.sessions() as session:
            run = service._run(session, run_id)
            solver = (run.result or {}).get("solver")
            if not solver:
                raise ServiceError(409, "This run has no proof graph yet")
            return solver["proof"]

    @router.get("/runs/{run_id}/program", response_class=PlainTextResponse, tags=["analysis"])
    def get_program(run_id: str, service: Backend):
        with service.db.sessions() as session:
            run = service._run(session, run_id)
            solver = (run.result or {}).get("solver")
            if not solver:
                raise ServiceError(409, "This run has no compiled program yet")
            return solver["program"]

    @router.post(
        "/runs/{run_id}/review",
        response_model=ReviewView,
        tags=["governance"],
        dependencies=[Depends(require_reviewer)],
    )
    def review_run(run_id: str, body: ReviewInput, service: Backend):
        return service.review(run_id, body)

    @router.get("/runs/{run_id}/review", response_model=ReviewView | None, tags=["governance"])
    def get_review(run_id: str, service: Backend):
        with service.db.sessions() as session:
            service._run(session, run_id)
            review = session.scalar(select(ReviewRecord).where(ReviewRecord.run_id == run_id))
            return record_dict(review) if review else None

    @router.get("/runs/{run_id}/executions", response_model=list[ExecutionView], tags=["execution"])
    def run_executions(run_id: str, service: Backend):
        with service.db.sessions() as session:
            service._run(session, run_id)
            executions = session.scalars(select(ExecutionRecord).where(ExecutionRecord.run_id == run_id)
                                          .order_by(ExecutionRecord.created_at.desc()))
            return [record_dict(execution) for execution in executions]

    @router.post(
        "/runs/{run_id}/execute",
        response_model=ExecutionView,
        tags=["execution"],
        dependencies=[Depends(require_reviewer)],
    )
    async def execute_run(
        run_id: str,
        body: ExecutionInput,
        service: Backend,
        idempotency_key: Annotated[
            str, Header(alias="Idempotency-Key", min_length=1, max_length=128)
        ],
    ):
        return await service.execute(run_id, body.payload, idempotency_key)

    @router.get("/executions/{execution_id}", response_model=ExecutionView, tags=["execution"])
    def get_execution(execution_id: str, service: Backend):
        with service.db.sessions() as session:
            execution = session.get(ExecutionRecord, execution_id)
            if not execution:
                raise ServiceError(404, "Execution not found")
            return record_dict(execution)

    @router.post(
        "/executions/{execution_id}/reconcile",
        response_model=ExecutionView,
        tags=["execution"],
        dependencies=[Depends(require_reviewer)],
    )
    def reconcile(execution_id: str, body: ReconcileInput, service: Backend):
        return service.reconcile(execution_id, body.outcome, body.note)

    @router.get("/disputes/{case_id}/audit", tags=["audit"])
    def get_audit(case_id: str, service: Backend):
        with service.db.sessions() as session:
            case = service._case(session, case_id)
            entries = audit_entries(session, case_id)
            return {
                "events": entries,
                "head": case.audit_hash,
                "verified": verify_chain(entries, case.audit_hash, case.audit_seq),
            }

    @router.get("/reviews", response_model=CasePage, tags=["governance"])
    def pending_reviews(
        service: Backend, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)
    ):
        with service.db.sessions() as session:
            query = select(CaseRecord).where(CaseRecord.status == "review_required")
            total = session.scalar(select(func.count()).select_from(query.subquery()))
            rows = session.scalars(
                query.order_by(CaseRecord.updated_at).offset(offset).limit(limit)
            )
            return {
                "items": [record_dict(row) for row in rows],
                "total": total,
                "offset": offset,
                "limit": limit,
            }

    @router.get("/metrics", tags=["operations"])
    def metrics(service: Backend):
        with service.db.sessions() as session:

            def counts(model):
                return dict(
                    session.execute(select(model.status, func.count()).group_by(model.status)).all()
                )

            return {
                "cases": counts(CaseRecord),
                "runs": counts(RunRecord),
                "executions": counts(ExecutionRecord),
                "webhooks": counts(WebhookRecord),
            }

    @router.get("/policies", tags=["policies"])
    def policies(service: Backend):
        service.reload_policies()
        return {"items": service.catalog.list()}

    @router.post(
        "/policies",
        status_code=201,
        response_model=PolicyDocument,
        tags=["policies"],
        dependencies=[Depends(require_reviewer)],
    )
    def import_policy(body: PolicyDocument, service: Backend):
        return service.import_policy(body)

    @router.get("/policies/{policy_id}", response_model=PolicyDocument, tags=["policies"])
    def policy_document(policy_id: str, service: Backend):
        service.reload_policies()
        return service.catalog.get(policy_id)

    @router.get("/policies/{policy_id}/toc", tags=["policies"])
    def policy_toc(policy_id: str, service: Backend):
        service.reload_policies()
        return {"policy_id": policy_id, "sections": service.catalog.toc(policy_id)}

    @router.get("/paypal/disputes", tags=["paypal"])
    async def paypal_disputes(
        service: Backend,
        page_size: int = Query(20, ge=1, le=50),
        next_page_token: str | None = Query(None, max_length=1000),
    ):
        return await service.paypal.list_disputes(
            page_size=page_size, next_page_token=next_page_token
        )

    @router.post("/paypal/disputes/{external_id}/import", response_model=CaseView, tags=["paypal"])
    async def import_dispute(external_id: str, body: ImportPayPalInput, service: Backend):
        return await service.import_paypal(external_id, body.policy_id, body.auto_execute)

    @router.get("/webhooks", tags=["operations"])
    def webhook_jobs(
        service: Backend, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)
    ):
        with service.db.sessions() as session:
            rows = session.scalars(
                select(WebhookRecord)
                .order_by(WebhookRecord.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
            return {"items": [record_dict(row) for row in rows]}

    @router.post(
        "/webhooks/{event_id}/retry", tags=["operations"], dependencies=[Depends(require_reviewer)]
    )
    def retry_webhook(event_id: str, service: Backend):
        with service.db.sessions.begin() as session:
            row = session.get(WebhookRecord, event_id)
            if not row:
                raise ServiceError(404, "Webhook not found")
            if row.status != "failed":
                raise ServiceError(409, "Only failed webhooks can be retried")
            row.status, row.error = "queued", None
            return {"id": row.id, "status": row.status}

    app.include_router(router)

    @app.post("/webhooks/paypal", status_code=202, tags=["paypal"])
    async def receive_webhook(request: Request, service: Backend):
        body = await request.body()
        if len(body) > 500_000:
            raise ServiceError(413, "Webhook payload too large")
        try:
            import json

            event = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            raise ServiceError(422, "Invalid JSON webhook") from None
        if not isinstance(event, dict):
            raise ServiceError(422, "Webhook must be an object")
        if not await service.paypal.verify_webhook(request.headers, event):
            raise ServiceError(401, "Webhook signature verification failed")
        return service.store_webhook(event)

    return app
