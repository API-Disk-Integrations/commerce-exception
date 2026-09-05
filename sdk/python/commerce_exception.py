"""
Commerce Exception Resolution API client.

Zero dependencies beyond the standard library — no requests, no httpx — so it
drops into any environment without a dependency negotiation.

    from commerce_exception import CommerceException

    client = CommerceException()             # reads COMMERCE_EXCEPTION_API_KEY
    client = CommerceException("sp_live_…")  # or pass it explicitly

Start free-key verification, then claim the token delivered by email:

    curl -X POST $COMMERCE_EXCEPTION_BASE_URL/v1/keys \
      -H 'content-type: application/json' -d '{"email":"you@example.com","source":{"source":"sdk","medium":"python"}}'

Two things to know before you integrate.

1. Every amount is an INTEGER number of minor units (cents). A fractional price
   is rejected by the API rather than rounded.
2. Each action carries an ``idempotencyKey`` derived from the remedy — the
   order, the exception type, the action, the currency, the amount, the subject
   — and NOT from the request. Pass it straight to your payment processor as
   its idempotency key. Replaying the same exception produces the same key, so
   a retried batch cannot refund the customer twice.
"""

from __future__ import annotations

import json as _json
import os
import urllib.error
import urllib.request

__all__ = [
    "CommerceException",
    "ApiError",
    "EXCEPTION_TYPES",
    "ACTION_KINDS",
    "ACTION_REASONS",
    "SEVERITIES",
    "actions_of", "API_TITLE", "API_VERSION", "API_BASE_URL", "ERROR_CODES", "OPERATIONS"]

#: Filled in at release with the deployed origin. Until then the client refuses
#: to guess a hostname: pass ``base_url=`` or set COMMERCE_EXCEPTION_BASE_URL.
#: A hard-coded wrong hostname in a published example is worse than no default.
DEFAULT_BASE_URL = "https://commerceexception-api.com"

#: Branch on these rather than on the human-readable ``detail``.
EXCEPTION_TYPES = (
    "duplicate_charge",
    "payment_captured_not_fulfilled",
    "shipment_lost_in_transit",
    "refund_owed_not_issued",
    "return_received_not_refunded",
    "inventory_oversold",
    "partial_shipment_unbilled_remainder",
    "return_not_restocked",
    "delivery_overdue",
    "no_exception",
)

ACTION_KINDS = ("refund", "recapture", "reship", "restock", "credit", "escalate", "no_action")

ACTION_REASONS = (
    "duplicate_capture_returned",
    "goods_not_received",
    "goods_returned_by_customer",
    "stock_returned_not_restocked",
    "unfulfillable_stock_shortfall",
    "shipment_declared_lost",
    "stock_available_for_reship",
    "overheld_balance_returned",
    "remainder_never_billed",
    "carrier_exception_needs_contact",
    "above_auto_refund_cap",
    "refund_window_closed",
    "no_authorization_headroom",
    "refund_ceiling_reached",
    "nothing_to_recover",
)

SEVERITIES = ("critical", "high", "medium", "low", "none")


def actions_of(resolution: dict, *kinds: str) -> list:
    """Actions of the given kinds, in execution order.

    ``actions_of(res, "refund", "credit")`` is the money-out list; anything left
    over is goods movement or a human decision.
    """
    return [a for a in resolution.get("actions", []) if a.get("kind") in kinds]


class ApiError(Exception):
    """
    Raised for any non-2xx response.

    NOT raised when a resolution comes back with ``no_exception`` — that is a
    successful answer to a legitimate question. On a 400, ``details["path"]``
    names the exact field that failed validation.
    """

    def __init__(self, status: int, code: str, message: str, request_id: str | None = None, details=None):
        super().__init__(f"[{status} {code}] {message}")
        self.status = status
        self.code = code
        self.message = message
        self.request_id = request_id
        self.details = details


class CommerceException:
    def __init__(self, api_key: str | None = None, *, base_url: str | None = None, timeout: float = 30.0):
        key = api_key or os.environ.get("COMMERCE_EXCEPTION_API_KEY")
        resolved = base_url or os.environ.get("COMMERCE_EXCEPTION_BASE_URL") or DEFAULT_BASE_URL
        if not resolved:
            raise ValueError(
                "No base URL. Pass base_url= or set COMMERCE_EXCEPTION_BASE_URL to the "
                "deployed origin shown on the service's landing page."
            )
        if not key:
            raise ValueError(
                "No API key. Pass one to CommerceException(...) or set "
                "COMMERCE_EXCEPTION_API_KEY. Request a free key verification email: POST "
                '{}/v1/keys with {{"email": "you@example.com"}}'.format(resolved.rstrip("/"))
            )
        self.api_key = key
        self.base_url = resolved.rstrip("/")
        self.timeout = timeout

    # -- transport ---------------------------------------------------------
    def _request(self, method: str, path: str, *, body=None, auth: bool = True) -> dict:
        data = _json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method)
        if auth:
            req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("Accept", "application/json")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return _json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            raw = e.read().decode()
            try:
                err = _json.loads(raw).get("error", {})
            except Exception:
                err = {}
            raise ApiError(
                e.code, err.get("code", "unknown"), err.get("message", raw[:200]),
                err.get("requestId"), err.get("details"),
            ) from None

    # -- API ---------------------------------------------------------------
    def health(self) -> dict:
        """Liveness and deployed version. Does not require a key."""
        return self._request("GET", "/health", auth=False)

    def resolve(self, exception_or_exceptions) -> dict:
        """
        Classify one order's state, or a list of up to 100.

        Billed one unit per exception submitted, however many findings and
        actions it produces. Returns ``resolutions``, each with a ledger, every
        finding on the order, one action per finding and a receipt.
        """
        body = (
            {"exceptions": exception_or_exceptions}
            if isinstance(exception_or_exceptions, list)
            else {"exception": exception_or_exceptions}
        )
        return self._request("POST", "/v1/exceptions", body=body)

    def demo_resolve(self, exception: dict) -> dict:
        """The real engine with no key: one exception, at most 10 lines and 10 charges."""
        return self._request("POST", "/v1/demo/resolve", body={"exception": exception}, auth=False)

    def exception_types(self) -> dict:
        """Every exception type, action kind, reason code and policy default, with meanings."""
        return self._request("GET", "/v1/exception-types", auth=False)

    @staticmethod
    def create_key(
        email: str,
        *,
        base_url: str | None = None,
        name: str | None = None,
        source: dict[str, str] | None = None,
    ) -> dict:
        """Request a free sandbox key; this emails a claim token. Claiming returns the key once."""
        resolved = base_url or os.environ.get("COMMERCE_EXCEPTION_BASE_URL") or DEFAULT_BASE_URL
        if not resolved:
            raise ValueError("No base URL. Pass base_url= or set COMMERCE_EXCEPTION_BASE_URL.")
        payload: dict = {
            "email": email,
            "source": source if source is not None else {"source": "sdk", "medium": "python"},
        }
        if name:
            payload["name"] = name
        req = urllib.request.Request(
            resolved.rstrip("/") + "/v1/keys", data=_json.dumps(payload).encode(), method="POST"
        )
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=30) as res:
            return _json.loads(res.read().decode())

# ---8<--- BEGIN GENERATED BY tools/gen-sdk.mjs — DO NOT EDIT BELOW ---8<---
# Everything between these markers is written from openapi.json. Change the
# service, regenerate the contract, then re-run `npm run gen:sdk`.

#: The contract this SDK was generated from.
API_TITLE = "Commerce Exception API"
API_VERSION = "1.0.0"
#: The origin the published contract names.
API_BASE_URL = "https://commerceexception-api.com"

#: Every ``error.code`` the contract publishes. Branch on these, never on the message.
ERROR_CODES = ("invalid_api_key", "missing_api_key", "quota_exceeded", "rate_limited", "invalid_request", "not_found", "method_not_allowed", "payload_too_large", "conflict", "internal_error")

#: The published surface, generated. Ships with the client so an integration
#: can assert against the contract instead of against a changelog.
OPERATIONS = (
    {
        "operation_id": "get/",
        "method": "GET",
        "path": "/",
        "summary": "Service index — endpoints, auth and error format",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "postApiBillingWebhook",
        "method": "POST",
        "path": "/api/billing/webhook",
        "summary": "Square billing events, forwarded by the shared hub",
        "auth": False,
        "auth_kind": "signature",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "getHealth",
        "method": "GET",
        "path": "/health",
        "summary": "Liveness and deployed version",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": (),
    },
    {
        "operation_id": "postV1Checkout",
        "method": "POST",
        "path": "/v1/checkout",
        "summary": "Start a hosted Square checkout for a paid tier",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("tier",),
        "success_status": 200,
        "response_fields": ("checkoutUrl", "tier", "sku", "requestId"),
    },
    {
        "operation_id": "postV1DemoResolve",
        "method": "POST",
        "path": "/v1/demo/resolve",
        "summary": "Public demo — resolve one exception without a key",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("exception",),
        "success_status": 200,
        "response_fields": ("resolution", "requestId"),
    },
    {
        "operation_id": "getV1ExceptionTypes",
        "method": "GET",
        "path": "/v1/exception-types",
        "summary": "Every exception type, action kind and reason code the engine emits",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("exceptionTypes", "severities", "actionKinds", "actionReasons", "policyDefaults", "refundPriority", "idempotency"),
    },
    {
        "operation_id": "postV1Exceptions",
        "method": "POST",
        "path": "/v1/exceptions",
        "summary": "Classify commerce exceptions and return an idempotent action plan",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("count", "actionable", "resolutions", "requestId"),
    },
    {
        "operation_id": "getV1Invoices",
        "method": "GET",
        "path": "/v1/invoices",
        "summary": "Every invoice issued against this account, newest first (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "count", "note", "invoices", "requestId"),
    },
    {
        "operation_id": "getV1Keys",
        "method": "GET",
        "path": "/v1/keys",
        "summary": "List your API keys for this API",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "accountId", "keys", "requestId"),
    },
    {
        "operation_id": "postV1Keys",
        "method": "POST",
        "path": "/v1/keys",
        "summary": "Request a free sandbox API key (sends a verification email)",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("email",),
        "success_status": 202,
        "response_fields": ("status", "email", "expiresAt", "next", "message", "requestId"),
    },
    {
        "operation_id": "postV1KeysIdRevoke",
        "method": "POST",
        "path": "/v1/keys/{id}/revoke",
        "summary": "Revoke one of your API keys",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": ("id",),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("id", "status", "message", "requestId"),
    },
    {
        "operation_id": "postV1KeysIdRotate",
        "method": "POST",
        "path": "/v1/keys/{id}/rotate",
        "summary": "Replace one of your API keys with a new secret",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": ("id",),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 201,
        "response_fields": ("apiKey", "keyId", "replaced", "product", "quotaPerPeriod", "plan", "warning", "requestId"),
    },
    {
        "operation_id": "postV1KeysClaim",
        "method": "POST",
        "path": "/v1/keys/claim",
        "summary": "Exchange an emailed claim token for the API key",
        "auth": False,
        "auth_kind": "public",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("token",),
        "success_status": 201,
        "response_fields": ("apiKey", "keyId", "product", "quotaPerPeriod", "plan", "warning", "usage", "requestId"),
    },
    {
        "operation_id": "getV1Payments",
        "method": "GET",
        "path": "/v1/payments",
        "summary": "Every payment attempted against this account and how it went (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "count", "note", "payments", "requestId"),
    },
    {
        "operation_id": "getV1Subscription",
        "method": "GET",
        "path": "/v1/subscription",
        "summary": "Your current plan, billing window and available changes (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "subscribed", "status", "plan", "pendingPlan", "planChangesGoThrough", "baseFeeOwner", "cancellation", "tiers", "requestId"),
    },
    {
        "operation_id": "postV1SubscriptionCancel",
        "method": "POST",
        "path": "/v1/subscription/cancel",
        "summary": "Cancel this plan and end metered access (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("canceled", "canceledAt", "entitlement", "money", "finalInvoice", "requestId"),
    },
    {
        "operation_id": "postV1SubscriptionPlan",
        "method": "POST",
        "path": "/v1/subscription/plan",
        "summary": "Upgrade or downgrade to another plan (dashboard session required)",
        "auth": False,
        "auth_kind": "session",
        "path_params": (),
        "query_params": (),
        "required_body_fields": ("planId",),
        "success_status": 200,
        "response_fields": ("changed", "direction", "from", "to", "entitlement", "billing", "requestId"),
    },
    {
        "operation_id": "getV1Usage",
        "method": "GET",
        "path": "/v1/usage",
        "summary": "Your consumption and remaining allowance for this period",
        "auth": True,
        "auth_kind": "api_key",
        "path_params": (),
        "query_params": (),
        "required_body_fields": (),
        "success_status": 200,
        "response_fields": ("product", "tier", "status", "unit", "period", "included", "used", "ceiling", "remaining", "overageSoFarMinor", "spendCapMinor", "requestId"),
    },
)
# ---8<--- END GENERATED BY tools/gen-sdk.mjs ---8<---
