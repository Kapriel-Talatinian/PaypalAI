"""Regression coverage for provider business data and exact audit snapshots.

Fixtures follow the official PayPal Customer Disputes v1 schema:
https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/customer_disputes_v1.json
No provider requests are made by these tests.
"""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from disputeflow.domain import Action, CaseInput, PayPalDisputeMetadata
from disputeflow.paypal import PayPalError, normalized_case


@pytest.fixture
def rich_snapshot():
    return {
        "dispute_id": "PP-D-424242",
        "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "status": "WAITING_FOR_SELLER_RESPONSE",
        "dispute_state": "REQUIRED_ACTION",
        "dispute_life_cycle_stage": "CHARGEBACK",
        "dispute_channel": "INTERNAL",
        "dispute_amount": {"value": "79.50", "currency_code": "EUR"},
        "create_time": "2026-10-01T10:00:00Z",
        "update_time": "2026-10-08T12:30:00Z",
        "seller_response_due_date": "2026-10-16T23:59:59+02:00",
        "buyer_response_due_date": "2026-10-20T23:59:59Z",
        "disputed_transactions": [
            {
                "seller_transaction_id": "8AB424242CD",
                "buyer_transaction_id": "4EF424242GH",
                "reference_id": "ORDER-1037",
                "create_time": "2026-09-28T09:12:00Z",
                "transaction_status": "PARTIALLY_REFUNDED",
                "gross_amount": {"value": "99.50", "currency_code": "EUR"},
                "invoice_number": "INV-1037",
                "custom": "Merchant checkout reference",
                "buyer": {"name": "Demo Customer"},
                "seller": {
                    "name": "Demo Merchant",
                    "email": "merchant@example.test",
                    "merchant_id": "MERCHANT4242",
                },
                "items": [
                    {
                        "item_id": "SKU4242",
                        "item_name": "Wireless headphones",
                        "item_description": "Black, model B",
                        "item_quantity": "2",
                        "item_type": "PRODUCT",
                        "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                        "dispute_amount": {"value": "79.50", "currency_code": "EUR"},
                        "partner_transaction_id": "PARTNER4242",
                        "notes": "One of two packages is disputed.",
                    }
                ],
            }
        ],
        "evidences": [
            {
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "source": "SELLER",
                "date": "2026-10-07T14:00:00Z",
                "notes": "Seller submitted tracking.",
                "item_id": "SKU4242",
                "item_type": "PRODUCT",
                "dispute_life_cycle_stage": "CHARGEBACK",
                "evidence_info": {
                    "tracking_info": [
                        {
                            "carrier_name": "OTHER",
                            "carrier_name_other": "Demo Carrier",
                            "tracking_number": "TRACK4242",
                            "tracking_url": "https://carrier.example.test/track/TRACK4242",
                        }
                    ]
                },
                "documents": [
                    {"name": "shipping-label.pdf", "url": "https://api.paypal.com/files/label"}
                ],
                "action_info": {"action": "PROVIDE_EVIDENCE", "mandatory": True},
            },
            {
                "evidence_type": "PROOF_OF_REFUND",
                "source": "SELLER",
                "date": "2026-10-07T15:00:00Z",
                "evidence_info": {"refund_ids": ["REFUND4242"]},
                "action_info": {
                    "action": "ACCEPT_CLAIM",
                    "response_option": "PARTIAL_REFUND",
                    "mandatory": False,
                },
            },
            {
                "evidence_type": "PROOF_OF_DELIVERY_SIGNATURE",
                "action_info": {"action": "PROVIDE_EVIDENCE", "mandatory": True},
            },
        ],
        "supporting_info": [
            {
                "notes": "Buyer provided correspondence.",
                "source": "BUYER",
                "provided_time": "2026-10-07T16:00:00Z",
                "dispute_life_cycle_stage": "CHARGEBACK",
                "documents": [{"name": "correspondence.pdf"}],
            }
        ],
        "extensions": {
            "merchandize_dispute_properties": {
                "product_details": {
                    "description": "Buyer reports no delivery.",
                    "product_received": "NO",
                    "expected_delivery_date": "2026-10-02T18:00:00Z",
                    "return_details": {
                        "return_time": "2026-10-06T12:00:00Z",
                        "mode": "SHIPPED",
                        "receipt": False,
                        "returned": False,
                        "return_confirmation_number": "RETURN4242",
                    },
                },
                "return_shipping_address": {
                    "address_line_1": "42 Example Street",
                    "admin_area_2": "Paris",
                    "postal_code": "75001",
                    "country_code": "FR",
                },
            }
        },
        "refund_details": {"allowed_refund_amount": {"value": "79.50", "currency_code": "EUR"}},
        "dispute_outcome": {
            "outcome_code": "NONE",
            "amount_refunded": {"value": "20.00", "currency_code": "EUR"},
        },
        "money_movements": [
            {
                "affected_party": "BUYER",
                "amount": {"value": "20.00", "currency_code": "EUR"},
                "initiated_time": "2026-10-07T15:00:00Z",
                "type": "REFUND",
                "reason": "PARTIAL_REFUND",
            }
        ],
        "allowed_response_options": {
            "accept_claim": {"accept_claim_types": ["REFUND", "PARTIAL_REFUND"]},
            "make_offer": {"offer_types": ["REFUND", "REFUND_WITH_RETURN"]},
            "acknowledge_return_item": {"acknowledgement_types": ["ITEM_RECEIVED"]},
        },
        "links": [
            {
                "href": "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-424242",
                "rel": "self",
                "method": "GET",
            },
            {
                "href": "https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-424242/provide-evidence",
                "rel": "provide_evidence",
                "method": "POST",
            },
        ],
    }


def test_rich_snapshot_normalizes_business_fields_and_retains_exact_source(rich_snapshot):
    original = deepcopy(rich_snapshot)
    case = normalized_case(rich_snapshot, "merchant_policy")
    data = case.paypal
    assert data is not None
    assert data.status == "WAITING_FOR_SELLER_RESPONSE"
    assert data.dispute_state == "REQUIRED_ACTION"
    assert data.dispute_life_cycle_stage == "CHARGEBACK"
    assert data.dispute_channel == "INTERNAL"
    assert data.seller_response_due_date == datetime(
        2026, 10, 16, 23, 59, 59, tzinfo=UTC
    ) - timedelta(hours=2)
    assert data.buyer_response_due_date == datetime(2026, 10, 20, 23, 59, 59, tzinfo=UTC)
    transaction = data.transactions[0]
    assert transaction.seller_transaction_id == "8AB424242CD"
    assert transaction.buyer.name == "Demo Customer"
    assert transaction.buyer.email is None
    assert transaction.seller.merchant_id == "MERCHANT4242"
    assert transaction.transaction_status == "PARTIALLY_REFUNDED"
    assert transaction.gross_amount.value == Decimal("99.50")
    assert transaction.invoice_number == "INV-1037"
    assert transaction.items[0].item_quantity == 2
    assert transaction.items[0].dispute_amount.value == Decimal("79.50")
    assert transaction.items[0].item_description == "Black, model B"
    assert data.existing_evidence[0].documents[0].name == "shipping-label.pdf"
    assert data.existing_evidence[0].source == "SELLER"
    assert data.requested_evidence[2].evidence_type == "PROOF_OF_DELIVERY_SIGNATURE"
    assert data.requested_evidence[1].mandatory is False
    assert data.requested_evidence[1].response_option == "PARTIAL_REFUND"
    assert data.tracking_info[0].tracking_number == "TRACK4242"
    assert data.refund_ids == ["REFUND4242"]
    assert data.supporting_info[0].documents[0].url is None
    assert data.delivery_details[0].product_received == "NO"
    assert data.delivery_details[0].product_received_time is None
    assert data.delivery_details[0].expected_delivery_date == datetime(2026, 10, 2, 18, tzinfo=UTC)
    assert data.delivery_details[0].returned is False
    assert data.return_shipping_address.country_code == "FR"
    assert data.refund_details.allowed_refund_amount.value == Decimal("79.50")
    assert data.refund_details.amount_refunded.value == Decimal("20.00")
    assert data.money_movements[0].amount.value == Decimal("20.00")
    assert data.allowed_response_options.accept_claim_types == ["REFUND", "PARTIAL_REFUND"]
    assert data.allowed_response_options.offer_types == ["REFUND", "REFUND_WITH_RETURN"]
    assert data.allowed_response_options.acknowledgement_types == ["ITEM_RECEIVED"]
    assert data.links[0].rel == "self"
    assert case.allowed_actions == [Action.PROVIDE_EVIDENCE]
    assert json.loads(case.evidence[0].content) == original
    assert rich_snapshot == original
    assert case.evidence[0].verified is False
    assert not case.auto_execute
    assert not data.normalization_warnings


def test_absent_values_remain_unknown_and_buyer_deadline_is_not_merchant_deadline():
    case = normalized_case(
        {
            "dispute_id": "PP-D-42",
            "reason": "OTHER",
            "dispute_amount": {"value": "1.00", "currency_code": "USD"},
            "buyer_response_due_date": "2026-11-01T00:00:00Z",
        },
        "demo_policy",
    )
    data = case.paypal
    assert data.status is None
    assert data.dispute_state is None
    assert data.dispute_life_cycle_stage is None
    assert data.create_time is None
    assert data.seller_response_due_date is None
    assert data.buyer_response_due_date is not None
    assert data.transactions == data.existing_evidence == data.requested_evidence == []
    assert data.delivery_details == data.tracking_info == data.refund_ids == []
    assert data.refund_details is None
    assert data.return_shipping_address is None
    assert data.allowed_response_options.offer_types == []
    assert case.allowed_actions == []
    assert "UNKNOWN" not in case.summary


def test_malformed_optional_provider_fields_are_reported_without_substitutes(rich_snapshot):
    rich_snapshot["status"] = {"invented": "OPEN"}
    rich_snapshot["seller_response_due_date"] = "2026-10-16"
    rich_snapshot["disputed_transactions"][0]["gross_amount"] = {
        "value": "NaN",
        "currency_code": "USD",
    }
    rich_snapshot["disputed_transactions"][0]["items"][0]["item_quantity"] = 2
    rich_snapshot["evidences"][0]["action_info"]["mandatory"] = "false"
    rich_snapshot["evidences"][0]["evidence_info"]["tracking_info"][0]["tracking_url"] = (
        "javascript:alert(1)"
    )
    rich_snapshot["evidences"].append("not an evidence object")
    rich_snapshot["allowed_response_options"]["make_offer"]["offer_types"] = "REFUND"
    case = normalized_case(rich_snapshot, "demo_policy")
    data = case.paypal
    assert data.status is None
    assert data.seller_response_due_date is None
    assert data.transactions[0].gross_amount is None
    assert data.transactions[0].items[0].item_quantity is None
    assert data.requested_evidence[0].mandatory is None
    assert data.tracking_info[0].tracking_url is None
    assert data.allowed_response_options.offer_types == []
    assert len(data.existing_evidence) == 3
    assert len(data.normalization_warnings) == 8
    assert any("seller_response_due_date" in warning for warning in data.normalization_warnings)
    assert all(
        "NaN" not in warning and "javascript" not in warning
        for warning in data.normalization_warnings
    )
    assert json.loads(case.evidence[0].content) == rich_snapshot


def test_future_fields_and_provider_codes_remain_traceable_without_breaking_import(rich_snapshot):
    rich_snapshot["new_provider_field"] = {"new": [1, False]}
    rich_snapshot["status"] = "FUTURE_PROVIDER_STATUS"
    rich_snapshot["dispute_amount"]["new_provider_amount_field"] = "future"
    rich_snapshot["disputed_transactions"][0]["items"][0]["future_item_field"] = "future"
    case = normalized_case(rich_snapshot, "demo_policy")
    assert case.paypal.status == "FUTURE_PROVIDER_STATUS"
    assert json.loads(case.evidence[0].content) == rich_snapshot
    assert not case.paypal.normalization_warnings


def test_allowed_response_options_never_grant_actions_without_safe_hateoas_links(rich_snapshot):
    rich_snapshot["links"][1]["href"] = "https://attacker.example.test/provide-evidence"
    case = normalized_case(rich_snapshot, "demo_policy")
    assert case.allowed_actions == []
    assert case.paypal.allowed_response_options.accept_claim_types
    assert case.paypal.links[1].href == "https://attacker.example.test/provide-evidence"


@pytest.mark.parametrize("field", ["dispute_id", "reason", "dispute_amount"])
def test_missing_required_provider_data_rejects_import_instead_of_inventing_values(
    rich_snapshot, field
):
    del rich_snapshot[field]
    with pytest.raises(PayPalError) as caught:
        normalized_case(rich_snapshot, "demo_policy")
    assert caught.value.status_code == 422
    assert caught.value.code == "INVALID_PAYPAL_INPUT"


@pytest.mark.parametrize(
    "value", ["NaN", "Infinity", "-1.00", "1.001", "12345678901234567.00", None, 1.0]
)
def test_malformed_disputed_amount_rejects_import(rich_snapshot, value):
    rich_snapshot["dispute_amount"]["value"] = value
    rich_snapshot["dispute_amount"]["currency_code"] = "USD"
    with pytest.raises(PayPalError):
        normalized_case(rich_snapshot, "demo_policy")


def test_supported_three_decimal_currency_preserves_provider_precision(rich_snapshot):
    rich_snapshot["dispute_amount"] = {"value": "12.345", "currency_code": "BHD"}
    case = normalized_case(rich_snapshot, "demo_policy")
    assert case.amount == Decimal("12.345")
    assert case.currency == "BHD"
    assert case.model_dump(mode="json")["amount"] == "12.345"


def test_metadata_preserves_zero_refund_and_signed_money_movement(rich_snapshot):
    rich_snapshot["dispute_outcome"]["amount_refunded"]["value"] = "0.00"
    rich_snapshot["money_movements"][0]["amount"]["value"] = "-20.00"
    case = normalized_case(rich_snapshot, "demo_policy")
    assert case.paypal.refund_details.amount_refunded.value == Decimal("0")
    assert case.paypal.money_movements[0].amount.value == Decimal("-20")


def test_optional_amount_with_invalid_currency_precision_is_unknown(rich_snapshot):
    rich_snapshot["disputed_transactions"][0]["gross_amount"] = {
        "value": "0.001",
        "currency_code": "USD",
    }
    case = normalized_case(rich_snapshot, "demo_policy")
    assert case.paypal.transactions[0].gross_amount is None
    assert any("gross_amount" in warning for warning in case.paypal.normalization_warnings)


def test_old_persisted_cases_still_validate_without_provider_metadata():
    case = CaseInput.model_validate(
        {
            "external_id": "PP-D-42",
            "reason": "OTHER",
            "amount": "1.00",
            "currency": "USD",
            "summary": "Legacy imported dispute.",
            "evidence": [],
            "allowed_actions": [],
            "policy_id": "demo_policy",
            "auto_execute": False,
        }
    )
    assert case.paypal is None


def test_provider_metadata_contract_rejects_untyped_fields_and_naive_dates():
    for extra in [{"seller_response_due_date": "2026-10-16T00:00:00"}, {"unknown": "extra"}]:
        with pytest.raises(ValidationError):
            PayPalDisputeMetadata.model_validate(
                {"dispute_id": "PP-D-42", "reason": "OTHER", **extra}
            )


def test_normalized_metadata_roundtrips_without_losing_provider_observations(rich_snapshot):
    case = normalized_case(rich_snapshot, "demo_policy")
    restored = CaseInput.model_validate_json(case.model_dump_json())
    assert restored.paypal == case.paypal
    assert restored.evidence == case.evidence
