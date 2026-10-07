from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from disputeflow.domain import CaseInput, PolicyDocument
from disputeflow.llm import DemoExtractor
from disputeflow.policy import PolicyCatalog, PolicyError, PolicyNotFound

ROOT = Path(__file__).resolve().parents[1]


def example(name: str = "unique.json") -> CaseInput:
    return CaseInput.model_validate_json((ROOT / "examples" / name).read_text())


def test_catalog_preserves_source_text_and_toc_excludes_bodies():
    catalog = PolicyCatalog(ROOT / "policies")
    document = catalog.get("demo_policy")
    assert document.synthetic
    assert document.source_url.startswith("urn:disputeflow:synthetic-demo:")
    toc = catalog.toc("demo_policy")
    assert "text" not in json.dumps(toc).replace('"has_text"', '"has_body"')
    assert toc[1]["children"][3]["children"][0]["id"] == "delivery_priority"
    document.sections[0].text = "modified"
    assert catalog.get("demo_policy").sections[0].text != "modified"


@pytest.mark.asyncio
async def test_stair_walk_returns_exact_clauses_and_navigation_trace():
    catalog = PolicyCatalog(ROOT / "policies")
    retrieval = await catalog.retrieve(example(), DemoExtractor())
    clauses = {clause.id: clause for clause in retrieval.clauses}
    assert "seller_delivery" in clauses
    assert "delivery_priority" in clauses
    assert "buyer_quality" not in clauses
    assert clauses["delivery_priority"].section_path == [
        "Nonreceipt demonstration",
        "Applicable nonreceipt rule priorities",
        "Delivery rule overrides nonreceipt rule",
    ]
    assert (
        clauses["seller_delivery"].sha256
        == hashlib.sha256(clauses["seller_delivery"].text.encode()).hexdigest()
    )
    assert len(retrieval.trace) == 3
    assert all(step["selector"] == "deterministic_demo" for step in retrieval.trace)


@pytest.mark.asyncio
async def test_stair_rejects_out_of_branch_and_duplicate_ids():
    class BadSelector:
        def __init__(self, selected):
            self.selected = selected

        async def select_sections(self, case, headings, path):
            return self.selected

    catalog = PolicyCatalog(ROOT / "policies")
    with pytest.raises(PolicyError, match="outside"):
        await catalog.retrieve(example(), BadSelector(["seller_delivery"]))
    with pytest.raises(PolicyError, match="duplicate"):
        await catalog.retrieve(example(), BadSelector(["demo_scope", "demo_scope"]))


@pytest.mark.asyncio
async def test_stair_fails_closed_when_clause_budget_is_too_small():
    with pytest.raises(PolicyError, match="retrieval_max_clauses"):
        await PolicyCatalog(ROOT / "policies", max_clauses=1).retrieve(example())


def test_import_is_atomic_persistent_and_existing_ids_are_immutable(tmp_path):
    source = PolicyCatalog(ROOT / "policies").get("demo_policy")
    source.id = "reviewed_policy"
    catalog = PolicyCatalog(tmp_path)
    imported = catalog.import_document(source)
    assert imported == source
    assert PolicyCatalog(tmp_path).get(source.id) == source
    assert catalog.import_document(source) == source
    source.version = "second-version"
    with pytest.raises(PolicyError, match="immutable"):
        catalog.import_document(source)
    assert not list(tmp_path.glob("*.tmp"))
    with pytest.raises(PolicyNotFound):
        catalog.get("missing")


@pytest.mark.asyncio
async def test_real_policy_requires_live_selector(tmp_path):
    source = PolicyCatalog(ROOT / "policies").get("demo_policy")
    source.synthetic = False
    catalog = PolicyCatalog(tmp_path)
    catalog.import_document(source)
    for selector in [None, DemoExtractor()]:
        with pytest.raises(PolicyError, match="configured LLM"):
            await catalog.retrieve(example(), selector)


def test_import_rejects_path_traversal_and_empty_policy(tmp_path):
    catalog = PolicyCatalog(tmp_path)
    source = PolicyCatalog(ROOT / "policies").get("demo_policy")
    source.id = "../outside"
    with pytest.raises(PolicyError, match="Policy ID"):
        catalog.import_document(source)
    source.id = "empty"
    source.sections = [source.sections[0].model_copy(update={"text": " "})]
    with pytest.raises(PolicyError, match="actual clause text"):
        catalog.import_document(source)


def test_load_bad_document_does_not_partially_replace_catalog(tmp_path):
    catalog = PolicyCatalog(tmp_path)
    document = PolicyCatalog(ROOT / "policies").get("demo_policy")
    catalog.import_document(document)
    (tmp_path / "broken.json").write_text('{"invalid": true}')
    with pytest.raises(PolicyError, match="Invalid policy"):
        catalog.load()
    assert catalog.get("demo_policy") == document


def test_document_contract_rejects_duplicate_section_ids():
    source = PolicyCatalog(ROOT / "policies").get("demo_policy").model_dump()
    source["sections"].append(source["sections"][0])
    with pytest.raises(ValueError, match="Section identifiers must be unique"):
        PolicyDocument.model_validate(source)


def test_database_registration_is_memory_only_immutable_and_returns_copies(tmp_path):
    directory = tmp_path / "no-local-files"
    catalog = PolicyCatalog(directory)
    document = PolicyCatalog(ROOT / "policies").get("demo_policy")
    document.id = "database_policy"
    returned = catalog.register_document(document)
    assert returned == document
    assert not directory.exists()
    assert catalog.register_document(document) == document
    returned.sections[0].text = "Caller mutation of returned copy."
    document.sections[0].text = "Caller mutation of supplied document."
    assert catalog.get("database_policy").sections[0].text not in {
        returned.sections[0].text,
        document.sections[0].text,
    }
    with pytest.raises(PolicyError, match="immutable"):
        catalog.register_document(document)
    assert not directory.exists()


def test_database_registration_checks_conflicts_with_bundled_policy():
    catalog = PolicyCatalog(ROOT / "policies")
    same = catalog.get("demo_policy")
    assert catalog.register_document(same) == same
    different = same.model_copy(deep=True)
    different.version = "different-database-version"
    with pytest.raises(PolicyError, match="immutable"):
        catalog.register_document(different)
    assert catalog.get("demo_policy") == same


def test_registration_revalidates_mutated_models_and_load_requires_reregistration(tmp_path):
    catalog = PolicyCatalog(tmp_path)
    document = PolicyCatalog(ROOT / "policies").get("demo_policy")
    oversized = document.model_copy(deep=True)
    oversized.sections[0].text = "x" * 80_001
    with pytest.raises(PolicyError, match="Invalid policy document"):
        catalog.register_document(oversized)
    assert not catalog.list()
    catalog.register_document(document)
    catalog.load()
    with pytest.raises(PolicyNotFound):
        catalog.get(document.id)
    catalog.register_document(document)
    assert catalog.get(document.id) == document
    assert not list(tmp_path.glob("*.json"))
