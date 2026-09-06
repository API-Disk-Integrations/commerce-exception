# Commerce Exception API

Classify order, payment, inventory, and shipping exceptions into bounded advisory actions with stable idempotency keys and an audit receipt.

- [Product and pricing](https://commerceexception-api.com/?utm_source=github&utm_medium=developer&utm_campaign=commerce-exception-github&utm_content=readme#pricing)
- [Developer documentation](https://commerceexception-api.com/docs?utm_source=github&utm_medium=developer&utm_campaign=commerce-exception-github&utm_content=readme)
- [Create a free account](https://commerceexception-api.com/signup?utm_source=github&utm_medium=developer&utm_campaign=commerce-exception-github&utm_content=readme)
- [OpenAPI contract](https://commerceexception-api.com/openapi.json)
- [Postman collection](./postman_collection.json)

## Quickstart: resolve a lost shipment with a duplicate capture without an account

The public demo runs the real production engine, stores nothing, meters nothing,
and requires no API key. The data below is synthetic.

```bash
cat > request.json <<'JSON'
{
  "exception": {
    "exceptionId": "case_88213",
    "orderId": "SO-90417",
    "currency": "USD",
    "placedAt": "2026-03-02T00:00:00Z",
    "observedAt": "2026-03-21T00:00:00Z",
    "orderStatus": "open",
    "lines": [
      {
        "sku": "KB-88",
        "description": "Mechanical keyboard",
        "orderedQty": 2,
        "shippedQty": 2,
        "deliveredQty": 0,
        "returnedQty": 0,
        "unitPriceMinor": 8900,
        "onHandQty": 0
      },
      {
        "sku": "CBL-2M",
        "description": "USB-C cable 2m",
        "orderedQty": 1,
        "shippedQty": 1,
        "deliveredQty": 1,
        "returnedQty": 0,
        "unitPriceMinor": 1900,
        "onHandQty": 40
      }
    ],
    "payment": {
      "capturedMinor": 39400,
      "refundedMinor": 0,
      "authorizedMinor": 0,
      "charges": [
        {
          "chargeId": "ch_A1",
          "amountMinor": 19700,
          "capturedAt": "2026-03-02T10:14:00Z",
          "status": "captured"
        },
        {
          "chargeId": "ch_A2",
          "amountMinor": 19700,
          "capturedAt": "2026-03-02T10:17:00Z",
          "status": "captured"
        }
      ]
    },
    "shipment": {
      "status": "lost",
      "carrier": "UPS",
      "trackingId": "1Z-4471",
      "lastScanAt": "2026-03-06T02:00:00Z",
      "promisedBy": "2026-03-09"
    }
  }
}
JSON

curl -sS -X POST https://commerceexception-api.com/v1/demo/resolve \
  -H 'content-type: application/json' \
  --data-binary @request.json
```

Selected fields from the deterministic 200 response (evaluated at
`2026-09-06T20:30:00.000Z` for this example):

```json
{
  "resolution": {
    "exceptionId": "case_88213",
    "severity": "critical",
    "findings": [
      {
        "type": "duplicate_charge",
        "severity": "critical",
        "amountMinor": 19700,
        "detail": "1 capture(s) of an amount already taken within 60 minute(s), worth 19700 minor units.",
        "evidence": [
          "charge ch_A2 captured 3 minute(s) after ch_A1 for the same 19700 minor units"
        ],
        "ageDays": 19,
        "agedUp": false
      },
      {
        "type": "shipment_lost_in_transit",
        "severity": "critical",
        "amountMinor": 17800,
        "units": 2,
        "detail": "The carrier declared the shipment lost with 17800 minor units of goods aboard.",
        "evidence": [
          "shipment.status=lost",
          "shipment.trackingId=1Z-4471",
          "daysSinceLastScan=15",
          "inTransitValueMinor=17800"
        ],
        "ageDays": 19,
        "agedUp": true
      }
    ],
    "actions": [
      {
        "kind": "refund",
        "exceptionType": "duplicate_charge",
        "amountMinor": 19700,
        "currency": "USD",
        "claimedMinor": 19700,
        "clipped": false,
        "reason": "duplicate_capture_returned",
        "detail": "Refund the duplicate capture through the original payment.",
        "idempotencyKey": "cxr_bdb5ff5fc060e3aa35f8c5d163170934"
      },
      {
        "kind": "refund",
        "exceptionType": "shipment_lost_in_transit",
        "amountMinor": 17800,
        "currency": "USD",
        "claimedMinor": 17800,
        "clipped": false,
        "units": 2,
        "reason": "shipment_declared_lost",
        "detail": "Refund the value of the goods that never arrived.",
        "idempotencyKey": "cxr_c698a66459a3e8f94efdd57c2b3d4941"
      }
    ],
    "totals": {
      "recoverableMinor": 37500,
      "refundMinor": 37500,
      "creditMinor": 0,
      "escalatedPayoutMinor": 0,
      "recaptureMinor": 0,
      "pendingRecaptureMinor": 0,
      "restockUnits": 0
    },
    "receipt": {
      "exceptionId": "case_88213",
      "orderId": "SO-90417",
      "currency": "USD",
      "decidedAt": "2026-09-06T20:30:00.000Z",
      "findingCount": 2,
      "actionCount": 2,
      "netCapturedMinor": 39400,
      "refundCeilingMinor": 39400,
      "moneyOutMinor": 37500,
      "moneyInMinor": 0,
      "evidence": [
        "duplicate_charge -> refund 19700 USD (duplicate_capture_returned) cxr_bdb5ff5fc060e3aa35f8c5d163170934",
        "shipment_lost_in_transit -> refund 17800 USD (shipment_declared_lost) cxr_c698a66459a3e8f94efdd57c2b3d4941"
      ],
      "digest": "823177ea0cc6b52cdedddca5bff2a383e2f8b4a518335881790a3c7fc4c36af1"
    },
    "warnings": []
  },
  "requestId": "req_example"
}
```

The first useful result is two critical findings and a bounded refund plan totaling 37,500 minor units. Each proposed action has a stable idempotency key; the API advises but does not execute a refund.

### Input contract

All money uses one currency and integer minor units. Include charge timestamps to detect duplicates and shipment state to bound what the merchant may retain.

## Create and use a free API key

```bash
curl -sS -X POST https://commerceexception-api.com/v1/keys \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","name":"github-quickstart","source":{"source":"github","medium":"developer","campaign":"commerce-exception-github","content":"readme"}}'

curl -sS -X POST https://commerceexception-api.com/v1/keys/claim \
  -H 'content-type: application/json' \
  -d '{"token":"PASTE_ONE_TIME_TOKEN_FROM_EMAIL"}'

export API_KEY='PASTE_API_KEY_FROM_CLAIM_RESPONSE'

curl -sS -X POST https://commerceexception-api.com/v1/exceptions \
  -H "Authorization: Bearer $API_KEY" \
  -H 'content-type: application/json' \
  --data-binary @request.json
```

The key-request response is `202` and sends a one-time claim token by email. The
claim response is the only place the raw API key is returned; store it securely
and never commit it. The authenticated endpoint accepts the same request shape
as the demo, with the documented production batch limits and metering.

## What to do next

Persist the returned receipt and route actions through your own approval and payment controls; never treat an advisory response as an executed payment.

The stable code catalogue for this product is `GET /v1/exception-types`. Branch on
machine-readable codes, not human-readable detail text.

## Authentication and troubleshooting

- `401`: the authenticated endpoint did not receive a valid active key. Set
  `API_KEY` to the value returned once by `/v1/keys/claim`; do not send a claim
  token as a bearer credential.
- `400 invalid_request`: read `error.details.path` when present and correct the
  named field. This service does **not** emit `422`; a client-side schema tool may
  show `422` before a request reaches the API.
- `429 quota_exceeded` or `429 rate_limited`: inspect `error.code`, honor
  `Retry-After` when present, and retry with bounded exponential backoff. A quota
  exhaustion requires a later quota window or plan change, not a tight retry loop.

Every API error has `{"error":{"code","message","requestId"}}`. Share the
request ID with support, never the API key, claim token, or customer payload.

## SDKs and authoritative contract

- Python: `./sdk/python/commerce_exception.py`
- TypeScript: `./sdk/typescript/index.ts`

The live OpenAPI document is authoritative for operations and schemas. This
overlay is a customer-runnable example aligned to that contract; it does not
replace the OpenAPI document or claim that an unresolved external contract is
authoritative.

## Distribution attribution

The key request above uses `commerce-exception-github` as the stable GitHub campaign. The
Postman collection uses `postman / collection / commerce-exception-postman /
public-collection`. These are attribution inputs, not claims of customers or
revenue.

## License

[MIT](./LICENSE)
