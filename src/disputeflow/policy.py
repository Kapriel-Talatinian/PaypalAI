"""Versioned policy ingestion and STAIR-style hierarchical ToC retrieval.

Policies are administrator supplied JSON documents, never fetched from arbitrary
URLs. Retrieval walks headings before reading clause bodies, and retains a
navigation trace and exact, hashed source text for every returned clause.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from .domain import CaseInput, Clause, PolicyDocument, PolicySection, RetrievalResult

if TYPE_CHECKING:
    from collections.abc import Sequence


class PolicyError(ValueError):
    """An imported policy or retrieval selection is invalid."""


class PolicyNotFound(KeyError):
    """The requested policy does not exist in this catalog."""


class SectionSelector(Protocol):
    async def select_sections(
        self, case: CaseInput, headings: list[dict[str, Any]], path: list[str]
    ) -> list[str]: ...


_SAFE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\Z")
_MAX_BYTES = 4 * 1024 * 1024
_MAX_DEPTH = 16
_MAX_SECTIONS = 1000


def _document_hash(document: PolicyDocument) -> str:
    raw = json.dumps(document.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def _validate_document(document: PolicyDocument) -> None:
    if not _SAFE_ID.fullmatch(document.id):
        raise PolicyError("Policy ID must contain only letters, digits, '.', '_' or '-'.")
    if not document.version.strip():
        raise PolicyError("Policies require an explicit, nonempty version.")
    if not document.sections:
        raise PolicyError("Policies must contain at least one section.")
    seen: set[str] = set()
    text_count = 0

    def walk(sections: Sequence[PolicySection], depth: int) -> None:
        nonlocal text_count
        if depth > _MAX_DEPTH:
            raise PolicyError("Policy section hierarchy is too deep.")
        for section in sections:
            if not _SAFE_ID.fullmatch(section.id):
                raise PolicyError(f"Invalid policy section ID: {section.id!r}.")
            if section.id in seen:
                raise PolicyError(f"Duplicate policy section ID: {section.id}.")
            seen.add(section.id)
            if len(seen) > _MAX_SECTIONS:
                raise PolicyError("Policy contains too many sections.")
            if not section.title.strip():
                raise PolicyError("Each section requires a nonempty heading.")
            if section.text.strip():
                text_count += 1
            walk(section.children, depth + 1)

    walk(document.sections, 1)
    if not text_count:
        raise PolicyError("Policy must contain actual clause text.")
    if len(document.model_dump_json().encode()) > _MAX_BYTES:
        raise PolicyError("Policy document exceeds the 4 MiB limit.")


def _validated_copy(document: PolicyDocument) -> PolicyDocument:
    _validate_document(document)
    # Revalidate mutated/constructed objects as well as API-validated input.
    try:
        return PolicyDocument.model_validate(document.model_dump(mode="json"))
    except ValueError as exc:
        raise PolicyError(f"Invalid policy document: {exc}") from exc


def _headings(sections: Sequence[PolicySection]) -> list[dict[str, Any]]:
    return [
        {
            "id": section.id,
            "title": section.title,
            "keywords": list(section.keywords),
            "has_text": bool(section.text.strip()),
            "children": _headings(section.children),
        }
        for section in sections
    ]


class PolicyCatalog:
    """An immutable-by-ID catalog of local and database-backed policy documents."""

    def __init__(self, policy_dir: str | Path, max_clauses: int = 12) -> None:
        if max_clauses < 1 or max_clauses > _MAX_SECTIONS:
            raise ValueError("max_clauses must be between 1 and 1000.")
        self.policy_dir = Path(policy_dir)
        self.max_clauses = max_clauses
        self._documents: dict[str, PolicyDocument] = {}
        self.load()

    def load(self) -> None:
        """Load a complete snapshot; a bad file never partially replaces it."""
        documents: dict[str, PolicyDocument] = {}
        if self.policy_dir.exists():
            for path in sorted(self.policy_dir.glob("*.json")):
                if path.stat().st_size > _MAX_BYTES:
                    raise PolicyError(f"Policy document {path.name} exceeds the 4 MiB limit.")
                try:
                    document = PolicyDocument.model_validate_json(path.read_bytes())
                    _validate_document(document)
                except (ValueError, UnicodeError) as exc:
                    raise PolicyError(f"Invalid policy document {path.name}: {exc}") from exc
                if document.id in documents:
                    raise PolicyError(f"Duplicate active policy ID: {document.id}.")
                documents[document.id] = document
        self._documents = documents

    def get(self, policy_id: str) -> PolicyDocument:
        try:
            return self._documents[policy_id].model_copy(deep=True)
        except KeyError as exc:
            raise PolicyNotFound(policy_id) from exc

    def list(self) -> list[dict[str, Any]]:
        return [
            {
                "id": document.id,
                "title": document.title,
                "version": document.version,
                "source_url": document.source_url,
                "synthetic": document.synthetic,
                "sha256": _document_hash(document),
            }
            for document in sorted(self._documents.values(), key=lambda value: value.id)
        ]

    def toc(self, policy_id: str) -> list[dict[str, Any]]:
        return _headings(self.get(policy_id).sections)

    def _existing_match(self, document: PolicyDocument) -> PolicyDocument | None:
        previous = self._documents.get(document.id)
        if previous is not None:
            if _document_hash(previous) == _document_hash(document):
                return previous
            raise PolicyError(
                "Existing policy IDs are immutable. Import a new policy ID for each revision."
            )
        return None

    def register_document(self, document: PolicyDocument) -> PolicyDocument:
        """Register an authoritative database document without filesystem writes.

        Registration checks conflicts with both bundled local documents and
        previously registered records. ``load()`` replaces the memory snapshot;
        database-backed callers re-register their persisted records after it.
        """
        document = _validated_copy(document)
        previous = self._existing_match(document)
        if previous is not None:
            return previous.model_copy(deep=True)
        self._documents[document.id] = document
        return document.model_copy(deep=True)

    def import_document(self, document: PolicyDocument) -> PolicyDocument:
        document = _validated_copy(document)
        previous = self._existing_match(document)
        if previous is not None:
            return previous.model_copy(deep=True)
        self.policy_dir.mkdir(parents=True, exist_ok=True)
        target = self.policy_dir / f"{document.id}.json"
        if target.exists():
            raise PolicyError("A policy file already exists; reload the catalog before importing.")
        temporary: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=self.policy_dir, suffix=".tmp", delete=False
            ) as handle:
                temporary = handle.name
                handle.write(document.model_dump_json(indent=2))
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            # link() is atomic and fails if another worker created this ID first.
            os.link(temporary, target)
        except FileExistsError as exc:
            raise PolicyError("Policy ID was concurrently imported by another worker.") from exc
        finally:
            if temporary is not None:
                Path(temporary).unlink(missing_ok=True)
        self._documents[document.id] = document
        return document.model_copy(deep=True)

    async def retrieve(
        self, case: CaseInput, extractor: SectionSelector | None = None
    ) -> RetrievalResult:
        document = self.get(case.policy_id)
        if not document.synthetic and (
            extractor is None or getattr(extractor, "provider", None) == "demo"
        ):
            raise PolicyError("Real policy retrieval requires a configured LLM section selector.")
        clauses: list[Clause] = []
        trace: list[dict[str, Any]] = []

        async def walk(sections: Sequence[PolicySection], path: list[str]) -> None:
            if not sections:
                return
            headings = _headings(sections)
            selected = (
                await extractor.select_sections(case, headings, path)
                if extractor is not None
                else _demo_selection(case, headings)
            )
            allowed = {section.id for section in sections}
            if not isinstance(selected, list) or any(
                not isinstance(value, str) or value not in allowed for value in selected
            ):
                raise PolicyError("STAIR selector returned a section outside the current ToC.")
            if len(selected) != len(set(selected)):
                raise PolicyError("STAIR selector returned duplicate section IDs.")
            trace.append(
                {
                    "path": list(path),
                    "offered": [section.id for section in sections],
                    "selected": list(selected),
                    "selector": "deterministic_demo"
                    if extractor is None or getattr(extractor, "provider", None) == "demo"
                    else "llm",
                }
            )
            for section in sections:
                if section.id not in selected:
                    continue
                section_path = [*path, section.title]
                if section.text.strip():
                    if len(clauses) >= self.max_clauses:
                        raise PolicyError(
                            "Relevant policy clauses exceed retrieval_max_clauses; "
                            "raise the configured limit or refine the policy hierarchy."
                        )
                    clauses.append(
                        Clause(
                            id=section.id,
                            section_path=section_path,
                            title=section.title,
                            text=section.text,
                            source_url=document.source_url,
                            version=document.version,
                            sha256=hashlib.sha256(section.text.encode()).hexdigest(),
                        )
                    )
                await walk(section.children, section_path)

        await walk(document.sections, [])
        if not clauses:
            raise PolicyError(
                "STAIR retrieval found no applicable clauses; human review is required."
            )
        return RetrievalResult(
            policy_id=document.id,
            policy_version=document.version,
            synthetic=document.synthetic,
            clauses=clauses,
            trace=trace,
        )


def _demo_selection(case: CaseInput, headings: list[dict[str, Any]]) -> list[str]:
    """Deterministic heading routing only for explicitly synthetic policies."""
    text = " ".join(
        [str(case.reason), case.summary, *(str(evidence.content) for evidence in case.evidence)]
    ).lower()
    tokens = set(re.findall(r"[a-z0-9_]+", text))

    def relevant(heading: dict[str, Any]) -> bool:
        keywords = [keyword.lower() for keyword in heading["keywords"]]
        return (
            "always" in keywords
            or any(keyword in tokens or keyword in text for keyword in keywords)
            or any(relevant(child) for child in heading["children"])
        )

    return [heading["id"] for heading in headings if relevant(heading)]
