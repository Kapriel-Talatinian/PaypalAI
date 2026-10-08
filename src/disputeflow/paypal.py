"""PayPal merchant dispute operations and remote webhook verification.

Dispute writes are deliberately sent once: the Disputes API does not document
PayPal-Request-Id support. A transport failure can therefore have an unknown
outcome and must be reconciled by an operator before another submission.
References: https://developer.paypal.com/api/customer-disputes/v1 and
https://developer.paypal.com/platforms/disputes/handle-disputes/use-disputes-api/.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from .config import Settings
from .domain import (
    Action,
    CaseInput,
    Evidence,
    PayPalDelivery,
    PayPalDisputeMetadata,
    PayPalDocument,
    PayPalEvidence,
    PayPalEvidenceRequirement,
    PayPalItem,
    PayPalLink,
    PayPalMoney,
    PayPalMoneyMovement,
    PayPalParty,
    PayPalRefundDetails,
    PayPalResponseOptions,
    PayPalReturnAddress,
    PayPalSupportingInfo,
    PayPalTracking,
    PayPalTransaction,
)

Json = dict[str, Any]
_BASE_URLS = {
    "sandbox": "https://api-m.sandbox.paypal.com",
    "live": "https://api-m.paypal.com",
}
_API_HOSTS = {
    "sandbox": {"api-m.sandbox.paypal.com", "api.sandbox.paypal.com"},
    "live": {"api-m.paypal.com", "api.paypal.com"},
}
_ENDPOINTS = {
    Action.ACCEPT_CLAIM: "accept-claim",
    Action.PROVIDE_EVIDENCE: "provide-evidence",
    Action.MAKE_OFFER: "make-offer",
    Action.ESCALATE: "escalate",
    Action.SEND_MESSAGE: "send-message",
}
_TRANSIENT = {429, 500, 502, 503, 504}
_DISPUTE_STATES = {
    "REQUIRED_ACTION",
    "REQUIRED_OTHER_PARTY_ACTION",
    "UNDER_PAYPAL_REVIEW",
    "RESOLVED",
    "OPEN_INQUIRIES",
    "APPEALABLE",
}
_OFFER_TYPES = {
    "REFUND",
    "REFUND_WITH_RETURN",
    "REFUND_WITH_REPLACEMENT",
    "REPLACEMENT_WITHOUT_REFUND",
}
_CLAIM_TYPES = {"REFUND", "REFUND_WITH_RETURN", "PARTIAL_REFUND"}
_EVIDENCE_TYPES = set(
    """
PROOF_OF_FULFILLMENT PROOF_OF_REFUND PROOF_OF_DELIVERY_SIGNATURE
PROOF_OF_RECEIPT_COPY RETURN_POLICY BILLING_AGREEMENT PROOF_OF_RESHIPMENT
ITEM_DESCRIPTION POLICE_REPORT AFFIDAVIT PAID_WITH_OTHER_METHOD COPY_OF_CONTRACT
TERMINAL_ATM_RECEIPT PRICE_DIFFERENCE_REASON SOURCE_CONVERSION_RATE BANK_STATEMENT
CREDIT_DUE_REASON REQUEST_CREDIT_RECEIPT PROOF_OF_RETURN CREATE CHANGE_REASON
PROOF_OF_REFUND_OUTSIDE_PAYPAL RECEIPT_OF_MERCHANDISE CUSTOMS_DOCUMENT
CUSTOMS_FEE_RECEIPT INFORMATION_ON_RESOLUTION ADDITIONAL_INFORMATION_OF_ITEM
DETAILS_OF_PURCHASE PROOF_OF_SIGNIFICANT_DIFFERENCE
PROOF_OF_SOFTWARE_OR_SERVICE_NOT_AS_DESCRIBED PROOF_OF_CONFISCATION PROOF_OF_DAMAGE
COPY_OF_LAW_ENFORCEMENT_AGENCY_REPORT ADDITIONAL_PROOF_OF_SHIPMENT
PROOF_OF_DENIAL_BY_CARRIER THIRDPARTY_PROOF_FOR_DAMAGE_OR_SIGNIFICANT_DIFFERENCE
VALID_SUPPORTING_DOCUMENT LEGIBLE_SUPPORTING_DOCUMENT RETURN_TRACKING_INFORMATION
DELIVERY_RECEIPT PROOF_OF_INSTORE_RECEIPT ADDITIONAL_TRACKING_INFORMATION
PROOF_OF_SHIPMENT_POSTAGE ONLINE_TRACKING_INFORMATION PROOF_OF_INSTORE_REFUND
PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED RETURN_ADDRESS_FOR_SHIPPING
COPY_OF_THE_EPARCEL_MANIFEST COPY_OF_SHIPPING_MANIFEST APPEAL_AFFIDAVIT
RECEIPT_OF_REPLACEMENT COPY_OF_DRIVERS_LICENSE ACCOUNT_CHANGE_INFORMATION
DELIVERY_ADDRESS CONFIRMATION_OF_RESOLUTION MERCHANT_RESPONSE PERMISSION_DESCRIPTION
STATUS_OF_MERCHANDISE LOST_CARD_DETAILS LAST_VALID_TRANSACTION_DETAILS
ADDITIONAL_PROOF_OF_RETURN DECLARATION PROOF_OF_MISSING_ITEMS
PROOF_OF_EMPTY_PACKAGE_OR_DIFFERENT_ITEM PROOF_OF_ITEM_NOT_RECEIVED ORDER_DETAILS
LISTING_URL SHIPPING_INSURANCE BUYER_RESPONSE PHOTOS_OF_SHIPPED_ITEM OTHER
CANCELLATION_DETAILS MERCHANT_CONTACT_DETAILS ITEM_DETAILS CORRECT_RECIPIENT_INFORMATION
EXPLANATION_OF_FUNDS_NOT_DELIVERED
""".split()
)
_ERROR_CODES = {
    "INTERNAL_SERVER_ERROR",
    "VALIDATION_ERROR",
    "RESOURCE_NOT_FOUND",
    "PERMISSION_DENIED",
    "AUTHENTICATION_FAILURE",
    "UNPROCESSABLE_ENTITY",
    "INVALID_REQUEST",
    "NOT_AUTHORIZED",
    "RATE_LIMIT_REACHED",
    "INVALID_RESOURCE_ID",
    "invalid_client",
    "invalid_token",
    "invalid_scope",
    "invalid_request",
    "server_error",
    "unauthorized_client",
    "unsupported_grant_type",
}
_SAFE_ID = re.compile(r"^[A-Za-z0-9-]{1,255}$")
_SAFE_CODE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


class PayPalError(RuntimeError):
    """Sanitized provider failure; uncertain means a write may have succeeded."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        debug_id: str | None = None,
        uncertain: bool = False,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.debug_id = debug_id
        self.uncertain = uncertain
        super().__init__(message)


def _invalid(message: str) -> PayPalError:
    return PayPalError(422, "INVALID_PAYPAL_INPUT", message)


def _object(value: Any, allowed: set[str], required: set[str], label: str) -> Json:
    if not isinstance(value, dict) or set(value) - allowed or required - set(value):
        raise _invalid(f"Invalid fields in {label}")
    return value


def _text(value: Any, label: str, *, maximum: int = 2000, pattern: str | None = None) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise _invalid(f"{label} must be nonempty text of at most {maximum} characters")
    if "\x00" in value or (pattern and not re.fullmatch(pattern, value)):
        raise _invalid(f"Invalid format for {label}")
    return value


def _money(value: Any, label: str) -> Decimal:
    money = _object(value, {"value", "currency_code"}, {"value", "currency_code"}, label)
    currency = _text(
        money["currency_code"], f"{label}.currency_code", maximum=3, pattern=r"[A-Z]{3}"
    )
    amount = _text(money["value"], f"{label}.value", maximum=32, pattern=r"[0-9]+(?:\.[0-9]+)?")
    places = (
        0
        if currency in {"JPY", "HUF", "TWD"}
        else 3
        if currency in {"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"}
        else 2
    )
    if (len(amount.split(".")[1]) if "." in amount else 0) > places:
        raise _invalid(f"Invalid decimal precision for {label}")
    result = Decimal(amount)
    if result <= 0:
        raise _invalid(f"{label} must be positive")
    return result


def _address(value: Any, label: str) -> None:
    lengths = {
        "address_line_1": 300,
        "address_line_2": 300,
        "address_line_3": 100,
        "admin_area_4": 100,
        "admin_area_3": 100,
        "admin_area_2": 120,
        "admin_area_1": 300,
        "postal_code": 60,
        "country_code": 2,
    }
    address = _object(
        value, set(lengths) | {"address_details"}, {"country_code", "address_line_1"}, label
    )
    for key, item in address.items():
        if key == "address_details":
            details = _object(
                item,
                {
                    "street_number",
                    "street_name",
                    "street_type",
                    "delivery_service",
                    "building_name",
                    "sub_building",
                },
                set(),
                label,
            )
            for detail, text in details.items():
                _text(text, f"{label}.address_details.{detail}", maximum=100)
        else:
            pattern = r"(?:[A-Z]{2}|C2)" if key == "country_code" else None
            _text(item, f"{label}.{key}", maximum=lengths[key], pattern=pattern)


def _evidence(value: Any) -> None:
    evidence = _object(
        value, {"evidence_type", "evidence_info", "notes", "item_id"}, {"evidence_type"}, "evidence"
    )
    kind = _text(evidence["evidence_type"], "evidence_type", maximum=255, pattern=r"[A-Z0-9_]+")
    if kind not in _EVIDENCE_TYPES:
        raise _invalid("Unsupported evidence_type")
    if "notes" in evidence:
        _text(evidence["notes"], "evidence.notes")
    if "item_id" in evidence:
        _text(evidence["item_id"], "evidence.item_id", maximum=255, pattern=r"[A-Za-z0-9]+")
    info = evidence.get("evidence_info", {})
    _object(info, {"tracking_info", "refund_ids"}, set(), "evidence_info")
    if "tracking_info" in info:
        records = info["tracking_info"]
        if not isinstance(records, list) or not 1 <= len(records) <= 10:
            raise _invalid("tracking_info must contain between 1 and 10 records")
        for record in records:
            _object(
                record,
                {"carrier_name", "carrier_name_other", "tracking_number", "tracking_url"},
                {"carrier_name", "tracking_number"},
                "tracking_info",
            )
            carrier = _text(
                record["carrier_name"], "carrier_name", maximum=255, pattern=r"[A-Z0-9_]+"
            )
            _text(record["tracking_number"], "tracking_number", maximum=255)
            if carrier == "OTHER" and "carrier_name_other" not in record:
                raise _invalid("OTHER carrier requires carrier_name_other")
            if "carrier_name_other" in record:
                _text(record["carrier_name_other"], "carrier_name_other")
            if "tracking_url" in record:
                url = urlsplit(_text(record["tracking_url"], "tracking_url"))
                if url.scheme != "https" or not url.hostname or url.username or url.password:
                    raise _invalid("tracking_url must be an HTTPS URL")
    if "refund_ids" in info:
        records = info["refund_ids"]
        if not isinstance(records, list) or not 1 <= len(records) <= 100:
            raise _invalid("refund_ids must contain between 1 and 100 IDs")
        for refund_id in records:
            _text(refund_id, "refund_id", maximum=255)
    if not evidence.get("notes") and not info:
        raise _invalid("Evidence must contain notes or tracking/refund information")
    if kind == "PROOF_OF_REFUND" and not info.get("refund_ids"):
        raise _invalid("PROOF_OF_REFUND requires refund_ids")


def validate_action_payload(action: Action, payload: Json) -> Json:
    """Validate supported JSON-only merchant operations before any network I/O.

    Binary evidence attachments require a separate multipart upload flow. Bare
    document names or URLs are rejected because they do not upload a document.
    """
    if not isinstance(action, Action) or action not in _ENDPOINTS:
        raise _invalid("Unsupported PayPal merchant action")
    if action == Action.SEND_MESSAGE:
        _object(payload, {"message"}, {"message"}, "send_message")
        _text(payload["message"], "message")
    elif action == Action.ESCALATE:
        _object(payload, {"note"}, {"note"}, "escalate")
        _text(payload["note"], "note")
    elif action == Action.PROVIDE_EVIDENCE:
        _object(payload, {"evidences"}, {"evidences"}, "provide_evidence")
        records = payload["evidences"]
        if not isinstance(records, list) or not 1 <= len(records) <= 100:
            raise _invalid("evidences must contain between 1 and 100 records")
        for record in records:
            _evidence(record)
    elif action == Action.MAKE_OFFER:
        _object(
            payload,
            {"note", "offer_type", "offer_amount", "return_shipping_address", "invoice_id"},
            {"note", "offer_type"},
            "make_offer",
        )
        _text(payload["note"], "note")
        if not isinstance(payload["offer_type"], str) or payload["offer_type"] not in _OFFER_TYPES:
            raise _invalid("Unsupported offer_type")
        if payload["offer_type"] == "REPLACEMENT_WITHOUT_REFUND":
            if "offer_amount" in payload:
                raise _invalid("REPLACEMENT_WITHOUT_REFUND cannot include offer_amount")
        elif "offer_amount" not in payload:
            raise _invalid("Refund offers require offer_amount")
        if "offer_amount" in payload:
            _money(payload["offer_amount"], "offer_amount")
        if (
            payload["offer_type"] == "REFUND_WITH_RETURN"
            and "return_shipping_address" not in payload
        ):
            raise _invalid("REFUND_WITH_RETURN requires return_shipping_address")
        if payload["offer_type"] != "REFUND_WITH_RETURN" and "return_shipping_address" in payload:
            raise _invalid("Return address requires REFUND_WITH_RETURN")
    else:
        _object(
            payload,
            {"note", "accept_claim_type", "refund_amount", "return_shipping_address", "invoice_id"},
            {"note"},
            "accept_claim",
        )
        _text(payload["note"], "note")
        claim_type = payload.get("accept_claim_type", "REFUND")
        if not isinstance(claim_type, str) or claim_type not in _CLAIM_TYPES:
            raise _invalid(
                "Unsupported accept_claim_type; shipment-label refunds require binary upload"
            )
        if claim_type == "PARTIAL_REFUND":
            if "refund_amount" not in payload:
                raise _invalid("PARTIAL_REFUND requires refund_amount")
            _money(payload["refund_amount"], "refund_amount")
        elif "refund_amount" in payload:
            raise _invalid("Only PARTIAL_REFUND can include refund_amount")
        if claim_type == "REFUND_WITH_RETURN" and "return_shipping_address" not in payload:
            raise _invalid("REFUND_WITH_RETURN requires return_shipping_address")
        if claim_type != "REFUND_WITH_RETURN" and "return_shipping_address" in payload:
            raise _invalid("Return address requires REFUND_WITH_RETURN")
    if "return_shipping_address" in payload:
        _address(payload["return_shipping_address"], "return_shipping_address")
    if "invoice_id" in payload:
        _text(payload["invoice_id"], "invoice_id", maximum=127)
    # Detach from caller mutations between validation, GET and POST.
    return json.loads(json.dumps(payload, allow_nan=False))


def _valid_action_link(
    link: Any, dispute_id: str, action: Action, environment: str | None = None
) -> bool:
    if not isinstance(link, dict) or str(link.get("rel", "")).replace("-", "_") != action.value:
        return False
    if str(link.get("method", "")).upper() != "POST":
        return False
    try:
        url = urlsplit(str(link.get("href", "")))
        hosts = _API_HOSTS[environment] if environment else set().union(*_API_HOSTS.values())
        return (
            url.scheme == "https"
            and url.hostname in hosts
            and url.port in {None, 443}
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and url.path == f"/v1/customer/disputes/{dispute_id}/{_ENDPOINTS[action]}"
        )
    except (ValueError, KeyError):
        return False


def available_actions(snapshot: Mapping[str, Any]) -> list[Action]:
    """Extract actions actually advertised for this dispute by PayPal."""
    dispute_id = snapshot.get("dispute_id")
    links = snapshot.get("links", [])
    if (
        not isinstance(dispute_id, str)
        or not _SAFE_ID.fullmatch(dispute_id)
        or not isinstance(links, list)
    ):
        return []
    return [
        action
        for action in _ENDPOINTS
        if any(_valid_action_link(link, dispute_id, action) for link in links)
    ]


class _SnapshotNormalizer:
    """Parse known optional fields while leaving unknown provider data in the raw snapshot."""

    def __init__(self) -> None:
        self.warnings: list[str] = []

    def invalid(self, path: str) -> None:
        self.warnings.append(f"Ignored malformed PayPal field: {path}")

    def obj(self, value: Any, path: str) -> Json:
        if value is None:
            return {}
        if not isinstance(value, dict):
            self.invalid(path)
            return {}
        return value

    def records(self, value: Any, path: str) -> list[tuple[Json, str]]:
        if value is None:
            return []
        if not isinstance(value, list):
            self.invalid(path)
            return []
        result = []
        for index, item in enumerate(value):
            item_path = f"{path}[{index}]"
            if isinstance(item, dict):
                result.append((item, item_path))
            else:
                self.invalid(item_path)
        return result

    def text(self, value: Any, path: str, maximum: int = 2000) -> str | None:
        if value is None:
            return None
        if (
            not isinstance(value, str)
            or not value.strip()
            or len(value) > maximum
            or "\x00" in value
        ):
            self.invalid(path)
            return None
        return value

    def strings(self, value: Any, path: str) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            self.invalid(path)
            return []
        result = []
        for index, item in enumerate(value):
            parsed = self.text(item, f"{path}[{index}]", 255)
            if parsed is not None and parsed not in result:
                result.append(parsed)
        return result

    def date(self, value: Any, path: str) -> datetime | None:
        if value is None:
            return None
        try:
            if not isinstance(value, str) or not re.fullmatch(
                r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value
            ):
                raise ValueError
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError
            return parsed
        except ValueError:
            self.invalid(path)
            return None

    def boolean(self, value: Any, path: str) -> bool | None:
        if value is None or isinstance(value, bool):
            return value
        self.invalid(path)
        return None

    def money(self, value: Any, path: str) -> PayPalMoney | None:
        if value is None:
            return None
        item = self.obj(value, path)
        amount, currency = item.get("value"), item.get("currency_code")
        if (
            not isinstance(amount, str)
            or len(amount) > 32
            or not re.fullmatch(r"-?(?:[0-9]+(?:\.[0-9]{1,3})?|\.[0-9]{1,3})", amount)
            or not isinstance(currency, str)
            or not re.fullmatch(r"[A-Z]{3}", currency)
        ):
            self.invalid(path)
            return None
        places = (
            0
            if currency in {"JPY", "HUF", "TWD"}
            else 3
            if currency in {"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"}
            else 2
        )
        if (len(amount.split(".")[1]) if "." in amount else 0) > places:
            self.invalid(path)
            return None
        return PayPalMoney(value=Decimal(amount), currency_code=currency)

    def url(self, value: Any, path: str) -> str | None:
        text = self.text(value, path)
        if text is None:
            return None
        try:
            url = urlsplit(text)
            if url.scheme != "https" or not url.hostname or url.username or url.password:
                raise ValueError
            _ = url.port
        except ValueError:
            self.invalid(path)
            return None
        return text

    def texts(self, item: Json, path: str, names: tuple[str, ...]) -> Json:
        return {name: self.text(item.get(name), f"{path}.{name}") for name in names}

    def party(self, value: Any, path: str) -> PayPalParty | None:
        item = self.obj(value, path)
        return (
            PayPalParty(**self.texts(item, path, ("name", "email", "merchant_id")))
            if item
            else None
        )

    def documents(self, value: Any, path: str) -> list[PayPalDocument]:
        return [
            PayPalDocument(
                name=self.text(item.get("name"), f"{p}.name"),
                url=self.url(item.get("url"), f"{p}.url"),
            )
            for item, p in self.records(value, path)
        ]

    def tracking(self, value: Any, path: str) -> list[PayPalTracking]:
        return [
            PayPalTracking(
                **self.texts(item, p, ("carrier_name", "carrier_name_other", "tracking_number")),
                tracking_url=self.url(item.get("tracking_url"), f"{p}.tracking_url"),
            )
            for item, p in self.records(value, path)
        ]

    def delivery(self, value: Any, path: str, item_id: str | None = None) -> PayPalDelivery | None:
        item = self.obj(value, path)
        if not item:
            return None
        returned = self.obj(item.get("return_details"), f"{path}.return_details")
        return PayPalDelivery(
            source_path=path,
            item_id=item_id,
            **self.texts(item, path, ("description", "product_received")),
            product_received_time=self.date(
                item.get("product_received_time"), f"{path}.product_received_time"
            ),
            expected_delivery_date=self.date(
                item.get("expected_delivery_date"), f"{path}.expected_delivery_date"
            ),
            return_time=self.date(
                returned.get("return_time"), f"{path}.return_details.return_time"
            ),
            return_mode=self.text(returned.get("mode"), f"{path}.return_details.mode"),
            return_receipt=self.boolean(returned.get("receipt"), f"{path}.return_details.receipt"),
            returned=self.boolean(returned.get("returned"), f"{path}.return_details.returned"),
            return_confirmation_number=self.text(
                returned.get("return_confirmation_number"),
                f"{path}.return_details.return_confirmation_number",
            ),
        )


def normalize_dispute_metadata(snapshot: Json) -> PayPalDisputeMetadata:
    """Normalize the official Disputes v1 fields without treating source claims as verified facts.

    ``evidences[].action_info`` advertises evidence requirements for an action,
    including submitted evidence; it does not mean the requirement is outstanding.
    A buyer deadline is never substituted for the merchant's response deadline.
    """
    n = _SnapshotNormalizer()
    deliveries: list[PayPalDelivery] = []
    transactions = []
    for transaction, path in n.records(
        snapshot.get("disputed_transactions"), "disputed_transactions"
    ):
        items = []
        for item, item_path in n.records(transaction.get("items"), f"{path}.items"):
            quantity = item.get("item_quantity")
            if quantity is not None and (
                not isinstance(quantity, str) or not re.fullmatch(r"[1-9][0-9]{0,9}", quantity)
            ):
                n.invalid(f"{item_path}.item_quantity")
                quantity = None
            record = PayPalItem(
                **n.texts(
                    item,
                    item_path,
                    (
                        "item_id",
                        "item_name",
                        "item_description",
                        "item_type",
                        "reason",
                        "partner_transaction_id",
                        "notes",
                    ),
                ),
                item_quantity=int(quantity) if quantity is not None else None,
                dispute_amount=n.money(item.get("dispute_amount"), f"{item_path}.dispute_amount"),
            )
            items.append(record)
            delivery = n.delivery(
                item.get("product_details"), f"{item_path}.product_details", record.item_id
            )
            if delivery is not None:
                deliveries.append(delivery)
        transactions.append(
            PayPalTransaction(
                **n.texts(
                    transaction,
                    path,
                    (
                        "seller_transaction_id",
                        "buyer_transaction_id",
                        "reference_id",
                        "transaction_status",
                        "invoice_number",
                        "custom",
                    ),
                ),
                create_time=n.date(transaction.get("create_time"), f"{path}.create_time"),
                gross_amount=n.money(transaction.get("gross_amount"), f"{path}.gross_amount"),
                buyer=n.party(transaction.get("buyer"), f"{path}.buyer"),
                seller=n.party(transaction.get("seller"), f"{path}.seller"),
                items=items,
            )
        )
    evidence, requirements, tracking, refund_ids = [], [], [], []
    for item, path in n.records(snapshot.get("evidences"), "evidences"):
        info = n.obj(item.get("evidence_info"), f"{path}.evidence_info")
        action_info = n.obj(item.get("action_info"), f"{path}.action_info")
        requirement = None
        if action_info:
            requirement = PayPalEvidenceRequirement(
                evidence_type=n.text(item.get("evidence_type"), f"{path}.evidence_type"),
                **n.texts(action_info, f"{path}.action_info", ("action", "response_option")),
                mandatory=n.boolean(action_info.get("mandatory"), f"{path}.action_info.mandatory"),
            )
            requirements.append(requirement)
        record = PayPalEvidence(
            **n.texts(
                item,
                path,
                (
                    "evidence_type",
                    "source",
                    "notes",
                    "item_id",
                    "item_type",
                    "dispute_life_cycle_stage",
                ),
            ),
            date=n.date(item.get("date"), f"{path}.date"),
            action_info=requirement,
            tracking_info=n.tracking(
                info.get("tracking_info"), f"{path}.evidence_info.tracking_info"
            ),
            refund_ids=n.strings(info.get("refund_ids"), f"{path}.evidence_info.refund_ids"),
            documents=n.documents(item.get("documents"), f"{path}.documents"),
        )
        evidence.append(record)
        tracking.extend(record.tracking_info)
        refund_ids.extend(
            refund_id for refund_id in record.refund_ids if refund_id not in refund_ids
        )
    extensions = n.obj(snapshot.get("extensions"), "extensions")
    merchandise = n.obj(
        extensions.get("merchandize_dispute_properties"),
        "extensions.merchandize_dispute_properties",
    )
    delivery = n.delivery(
        merchandise.get("product_details"),
        "extensions.merchandize_dispute_properties.product_details",
    )
    if delivery is not None:
        deliveries.append(delivery)
    address = n.obj(
        merchandise.get("return_shipping_address"),
        "extensions.merchandize_dispute_properties.return_shipping_address",
    )
    refund = n.obj(snapshot.get("refund_details"), "refund_details")
    outcome = n.obj(snapshot.get("dispute_outcome"), "dispute_outcome")
    response = n.obj(snapshot.get("allowed_response_options"), "allowed_response_options")
    response_types = {}
    for key, field in (
        ("accept_claim", "accept_claim_types"),
        ("make_offer", "offer_types"),
        ("acknowledge_return_item", "acknowledgement_types"),
    ):
        options = n.obj(response.get(key), f"allowed_response_options.{key}")
        response_types[field] = n.strings(
            options.get(field), f"allowed_response_options.{key}.{field}"
        )
    links = []
    for item, path in n.records(snapshot.get("links"), "links"):
        href, rel = n.url(item.get("href"), f"{path}.href"), n.text(item.get("rel"), f"{path}.rel")
        if href is not None and rel is not None:
            links.append(
                PayPalLink(href=href, rel=rel, method=n.text(item.get("method"), f"{path}.method"))
            )
    metadata = PayPalDisputeMetadata(
        dispute_id=snapshot["dispute_id"],
        reason=snapshot["reason"],
        **n.texts(
            snapshot,
            "dispute",
            ("status", "dispute_state", "dispute_life_cycle_stage", "dispute_channel"),
        ),
        **{
            name: n.date(snapshot.get(name), name)
            for name in (
                "create_time",
                "update_time",
                "seller_response_due_date",
                "buyer_response_due_date",
            )
        },
        transactions=transactions,
        existing_evidence=evidence,
        requested_evidence=requirements,
        supporting_info=[
            PayPalSupportingInfo(
                **n.texts(item, path, ("notes", "source", "dispute_life_cycle_stage")),
                provided_time=n.date(item.get("provided_time"), f"{path}.provided_time"),
                documents=n.documents(item.get("documents"), f"{path}.documents"),
            )
            for item, path in n.records(snapshot.get("supporting_info"), "supporting_info")
        ],
        tracking_info=tracking,
        refund_ids=refund_ids,
        delivery_details=deliveries,
        return_shipping_address=PayPalReturnAddress(
            **n.texts(address, "return_shipping_address", tuple(PayPalReturnAddress.model_fields))
        )
        if address
        else None,
        refund_details=PayPalRefundDetails(
            allowed_refund_amount=n.money(
                refund.get("allowed_refund_amount"), "refund_details.allowed_refund_amount"
            ),
            amount_refunded=n.money(
                outcome.get("amount_refunded"), "dispute_outcome.amount_refunded"
            ),
            outcome_code=n.text(outcome.get("outcome_code"), "dispute_outcome.outcome_code"),
        )
        if refund or outcome
        else None,
        money_movements=[
            PayPalMoneyMovement(
                **n.texts(item, path, ("affected_party", "type", "reason")),
                amount=n.money(item.get("amount"), f"{path}.amount"),
                initiated_time=n.date(item.get("initiated_time"), f"{path}.initiated_time"),
            )
            for item, path in n.records(snapshot.get("money_movements"), "money_movements")
        ],
        allowed_response_options=PayPalResponseOptions(**response_types),
        links=links,
    )
    metadata.normalization_warnings = list(dict.fromkeys(n.warnings))
    return metadata


def normalized_case(snapshot: Json, policy_id: str) -> CaseInput:
    """Keep the original provider snapshot unverified alongside typed observations."""
    if not isinstance(snapshot, dict):
        raise _invalid("Dispute snapshot must be a JSON object")
    dispute_id = _text(
        snapshot.get("dispute_id"), "dispute_id", maximum=128, pattern=r"[A-Za-z0-9-]+"
    )
    reason = _text(snapshot.get("reason"), "reason", maximum=128)
    provider_amount = snapshot.get("dispute_amount")
    if not isinstance(provider_amount, dict):
        raise _invalid("Dispute amount must be supplied by PayPal")
    amount = {
        key: provider_amount[key] for key in ("value", "currency_code") if key in provider_amount
    }
    _money(amount, "dispute_amount")
    try:
        encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, allow_nan=False)
    except (ValueError, TypeError):
        raise _invalid("Dispute snapshot must contain valid JSON values") from None
    if len(encoded) > 40_000:
        raise _invalid("Dispute snapshot exceeds case evidence size limit")
    metadata = normalize_dispute_metadata(snapshot)
    summary = f"PayPal dispute {dispute_id}: {reason}."
    if metadata.status is not None:
        summary += f" Status: {metadata.status}."
    if metadata.dispute_life_cycle_stage is not None:
        summary += f" Stage: {metadata.dispute_life_cycle_stage}."
    try:
        return CaseInput(
            external_id=dispute_id,
            reason=reason,
            amount=Decimal(amount["value"]),
            currency=amount["currency_code"],
            summary=summary,
            evidence=[
                Evidence(
                    id="paypal_snapshot",
                    kind="paypal",
                    content=encoded,
                    verified=False,
                    source="paypal_api",
                )
            ],
            policy_id=policy_id,
            allowed_actions=available_actions(snapshot),
            paypal=metadata,
        )
    except ValidationError:
        raise _invalid("Dispute snapshot exceeds the validated case contract limits") from None


class PayPalClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.base_url = _BASE_URLS[settings.paypal_environment]
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(
            timeout=settings.paypal_timeout_seconds, follow_redirects=False
        )
        self._token: str | None = None
        self._token_expiry = 0.0
        self._token_lock = asyncio.Lock()

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    @staticmethod
    def _retry_delay(response: httpx.Response | None, attempt: int) -> float | None:
        if response is not None and "retry-after" in response.headers:
            value = response.headers["retry-after"]
            try:
                delay = float(value)
            except ValueError:
                try:
                    delay = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
                except (ValueError, TypeError, OverflowError):
                    delay = 0.25 * 2**attempt
            # Do not retry earlier than PayPal requests. Long backoffs are left
            # to the durable caller instead of holding an HTTP handler open.
            return max(delay, 0) if delay <= 2.0 else None
        return min(0.25 * 2**attempt, 2.0)

    def _response_error(self, response: httpx.Response, *, write: bool) -> PayPalError:
        try:
            body = response.json()
        except ValueError:
            body = {}
        if not isinstance(body, dict):
            body = {}
        code = body.get("name", body.get("error", "PAYPAL_HTTP_ERROR"))
        if not isinstance(code, str) or code not in _ERROR_CODES:
            code = "PAYPAL_HTTP_ERROR"
        debug_id = body.get("debug_id", response.headers.get("paypal-debug-id"))
        if not isinstance(debug_id, str) or not _SAFE_CODE.fullmatch(debug_id):
            debug_id = None
        secrets = [self._token]
        if self.settings.paypal_client_secret:
            secrets.append(self.settings.paypal_client_secret.get_secret_value())
        if any(secret and secret in code for secret in secrets):
            code = "PAYPAL_HTTP_ERROR"
        if debug_id and any(secret and secret in debug_id for secret in secrets):
            debug_id = None
        # Provider message/detail fields can echo PII or submitted credentials.
        return PayPalError(
            response.status_code,
            code,
            f"PayPal returned HTTP {response.status_code}",
            debug_id,
            uncertain=write and response.status_code >= 500,
        )

    async def _send(
        self, method: str, path: str, *, retry_safe: bool, write: bool = False, **kwargs: Any
    ) -> Json:
        for attempt in range(3 if retry_safe else 1):
            try:
                response = await self._client.request(
                    method,
                    self.base_url + path,
                    timeout=self.settings.paypal_timeout_seconds,
                    follow_redirects=False,
                    **kwargs,
                )
            except httpx.TransportError:
                if retry_safe and attempt < 2:
                    await asyncio.sleep(self._retry_delay(None, attempt) or 0)
                    continue
                raise PayPalError(
                    0,
                    "PAYPAL_TRANSPORT_ERROR",
                    "PayPal request could not be completed",
                    uncertain=write,
                ) from None
            if response.status_code in _TRANSIENT and retry_safe and attempt < 2:
                delay = self._retry_delay(response, attempt)
                if delay is not None:
                    await asyncio.sleep(delay)
                    continue
            if not 200 <= response.status_code < 300:
                raise self._response_error(response, write=write)
            if response.status_code == 204 or not response.content:
                return {}
            try:
                result = response.json()
            except ValueError:
                raise PayPalError(
                    response.status_code,
                    "PAYPAL_INVALID_RESPONSE",
                    "PayPal returned an invalid JSON response",
                    uncertain=write,
                ) from None
            if not isinstance(result, dict):
                raise PayPalError(
                    response.status_code,
                    "PAYPAL_INVALID_RESPONSE",
                    "PayPal returned an invalid JSON object",
                    uncertain=write,
                )
            return result
        raise AssertionError("Unreachable retry state")

    async def _access_token(self) -> str:
        if self._token and time.monotonic() < self._token_expiry:
            return self._token
        async with self._token_lock:
            if self._token and time.monotonic() < self._token_expiry:
                return self._token
            secret = self.settings.paypal_client_secret
            if not self.settings.paypal_client_id or not secret or not secret.get_secret_value():
                raise PayPalError(
                    503, "PAYPAL_NOT_CONFIGURED", "PayPal client credentials are not configured"
                )
            result = await self._send(
                "POST",
                "/v1/oauth2/token",
                retry_safe=True,
                auth=httpx.BasicAuth(self.settings.paypal_client_id, secret.get_secret_value()),
                data={"grant_type": "client_credentials"},
                headers={"Accept": "application/json"},
            )
            token = result.get("access_token")
            expiry = result.get("expires_in")
            if (
                not isinstance(token, str)
                or not token
                or not isinstance(expiry, (int, float))
                or isinstance(expiry, bool)
                or not 0 < expiry < 10_000_000
            ):
                raise PayPalError(
                    502,
                    "PAYPAL_INVALID_TOKEN_RESPONSE",
                    "PayPal returned invalid OAuth credentials",
                )
            self._token = token
            self._token_expiry = time.monotonic() + max(expiry - min(30, expiry / 10), 0)
            return token

    async def _authorized(
        self, method: str, path: str, *, retry_safe: bool, write: bool = False, **kwargs: Any
    ) -> Json:
        token = await self._access_token()
        try:
            return await self._send(
                method,
                path,
                retry_safe=retry_safe,
                write=write,
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                **kwargs,
            )
        except PayPalError as error:
            if error.status_code != 401:
                raise
            self._token = None
            self._token_expiry = 0
            if not retry_safe:
                raise
        token = await self._access_token()
        return await self._send(
            method,
            path,
            retry_safe=retry_safe,
            write=write,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            **kwargs,
        )

    async def get_dispute(self, dispute_id: str) -> Json:
        if not isinstance(dispute_id, str) or not _SAFE_ID.fullmatch(dispute_id):
            raise _invalid("Invalid PayPal dispute ID")
        result = await self._authorized(
            "GET", f"/v1/customer/disputes/{dispute_id}", retry_safe=True
        )
        if result.get("dispute_id") != dispute_id:
            raise PayPalError(
                502, "PAYPAL_DISPUTE_MISMATCH", "PayPal returned a different dispute ID"
            )
        return result

    async def list_disputes(
        self,
        *,
        page_size: int = 10,
        start_time: str | None = None,
        disputed_transaction_id: str | None = None,
        next_page_token: str | None = None,
        dispute_state: str | None = None,
        update_time_before: str | None = None,
        update_time_after: str | None = None,
    ) -> Json:
        if (
            isinstance(page_size, bool)
            or not isinstance(page_size, int)
            or not 1 <= page_size <= 50
        ):
            raise _invalid("page_size must be between 1 and 50")
        if start_time and disputed_transaction_id:
            raise _invalid("start_time and disputed_transaction_id are mutually exclusive")
        params: dict[str, str | int] = {"page_size": page_size}
        for key, value in {
            "start_time": start_time,
            "update_time_before": update_time_before,
            "update_time_after": update_time_after,
        }.items():
            if value is not None:
                _text(value, key, maximum=64)
                try:
                    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                except ValueError:
                    raise _invalid(f"{key} must be a timezone-aware RFC3339 timestamp") from None
                if parsed.tzinfo is None or not datetime.now(UTC) - timedelta(
                    days=180
                ) <= parsed <= datetime.now(UTC):
                    raise _invalid(f"{key} must be within the last 180 days")
                params[key] = value
        if disputed_transaction_id is not None:
            params["disputed_transaction_id"] = _text(
                disputed_transaction_id,
                "disputed_transaction_id",
                maximum=255,
                pattern=r"[0-9A-Z_]+",
            )
        if next_page_token is not None:
            params["next_page_token"] = _text(
                next_page_token, "next_page_token", maximum=255, pattern=r"[A-Za-z0-9+/=]+"
            )
        if dispute_state is not None:
            _text(dispute_state, "dispute_state", maximum=2000)
            if set(dispute_state.split(",")) - _DISPUTE_STATES:
                raise _invalid("Unknown dispute_state")
            params["dispute_state"] = dispute_state
        return await self._authorized(
            "GET", "/v1/customer/disputes", retry_safe=True, params=params
        )

    async def execute(
        self,
        dispute_id: str,
        action: Action,
        payload: Json,
        request_id: str,
        *,
        expected_snapshot_hash: str | None = None,
    ) -> Json:
        if (
            self.settings.execution_mode == "dry_run"
            or self.settings.execution_mode != self.settings.paypal_environment
        ):
            raise PayPalError(
                409,
                "PAYPAL_EXECUTION_DISABLED",
                "PayPal writes require an execution mode matching the provider environment",
            )
        _text(request_id, "request_id", maximum=128, pattern=r"[A-Za-z0-9_.-]+")
        if expected_snapshot_hash is not None:
            _text(
                expected_snapshot_hash,
                "expected_snapshot_hash",
                maximum=64,
                pattern=r"[a-f0-9]{64}",
            )
        validated = validate_action_payload(action, payload)
        snapshot = await self.get_dispute(dispute_id)
        if expected_snapshot_hash is not None:
            current_hash = hashlib.sha256(
                json.dumps(
                    snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False
                ).encode()
            ).hexdigest()
            if current_hash != expected_snapshot_hash:
                raise PayPalError(
                    409,
                    "STALE_DISPUTE",
                    "PayPal dispute changed; refresh and reanalyze before execution",
                )
        links = snapshot.get("links", [])
        if not isinstance(links, list) or not any(
            _valid_action_link(link, dispute_id, action, self.settings.paypal_environment)
            for link in links
        ):
            raise PayPalError(
                409,
                "PAYPAL_ACTION_UNAVAILABLE",
                "The requested action is no longer available for this dispute",
            )
        options = snapshot.get("allowed_response_options", {})
        if not isinstance(options, dict):
            raise PayPalError(
                502, "PAYPAL_INVALID_RESPONSE", "PayPal returned invalid response options"
            )
        if action == Action.MAKE_OFFER:
            offer_options = options.get("make_offer", {})
            if not isinstance(offer_options, dict):
                raise PayPalError(
                    502, "PAYPAL_INVALID_RESPONSE", "PayPal returned invalid offer options"
                )
            types = offer_options.get("offer_types", [])
            if not isinstance(types, list):
                types = []
            if validated["offer_type"] not in types:
                raise PayPalError(
                    409,
                    "PAYPAL_OFFER_UNAVAILABLE",
                    "The requested offer type is unavailable for this dispute",
                )
        if action == Action.ACCEPT_CLAIM:
            claim_options = options.get("accept_claim", {})
            if not isinstance(claim_options, dict):
                raise PayPalError(
                    502, "PAYPAL_INVALID_RESPONSE", "PayPal returned invalid claim options"
                )
            types = claim_options.get("accept_claim_types")
            if types is not None and not isinstance(types, list):
                raise PayPalError(
                    502, "PAYPAL_INVALID_RESPONSE", "PayPal returned invalid claim types"
                )
            if types is not None and validated.get("accept_claim_type", "REFUND") not in types:
                raise PayPalError(
                    409,
                    "PAYPAL_CLAIM_TYPE_UNAVAILABLE",
                    "The requested refund type is unavailable for this dispute",
                )
        for key in ("offer_amount", "refund_amount"):
            if key in validated:
                limit = snapshot.get("dispute_amount", {})
                amount = _money(validated[key], key)
                if validated[key]["currency_code"] != limit.get("currency_code") or amount > _money(
                    limit, "dispute_amount"
                ):
                    raise _invalid(
                        "Refund amount must use the dispute currency and not exceed its amount"
                    )
        # The local request ID is intentionally NOT an upstream idempotency claim.
        return await self._authorized(
            "POST",
            f"/v1/customer/disputes/{dispute_id}/{_ENDPOINTS[action]}",
            retry_safe=False,
            write=True,
            json=validated,
        )

    async def verify_webhook(self, headers: Mapping[str, str], event: Json) -> bool:
        if not self.settings.paypal_webhook_id:
            raise PayPalError(
                503, "PAYPAL_WEBHOOK_NOT_CONFIGURED", "PayPal webhook ID is not configured"
            )
        normalized = {key.lower(): value for key, value in headers.items()}
        required = {
            "auth_algo": "paypal-auth-algo",
            "cert_url": "paypal-cert-url",
            "transmission_id": "paypal-transmission-id",
            "transmission_sig": "paypal-transmission-sig",
            "transmission_time": "paypal-transmission-time",
        }
        if not all(
            isinstance(normalized.get(name), str)
            and normalized[name].strip()
            and len(normalized[name]) <= 8192
            for name in required.values()
        ):
            return False
        try:
            cert = urlsplit(normalized["paypal-cert-url"])
            if (
                cert.scheme != "https"
                or cert.hostname not in _API_HOSTS[self.settings.paypal_environment]
                or cert.port not in {None, 443}
                or cert.username
                or cert.password
                or cert.query
                or cert.fragment
                or not cert.path.startswith("/v1/notifications/certs/")
            ):
                return False
        except ValueError:
            return False
        if not isinstance(event, dict) or not event.get("id"):
            return False
        payload = {key: normalized[name] for key, name in required.items()}
        payload.update({"webhook_id": self.settings.paypal_webhook_id, "webhook_event": event})
        # PayPal performs signature verification; no client-side URL is fetched.
        result = await self._authorized(
            "POST", "/v1/notifications/verify-webhook-signature", retry_safe=True, json=payload
        )
        return result.get("verification_status") == "SUCCESS"
