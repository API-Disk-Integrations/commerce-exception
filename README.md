# Commerce Exception API

Detect and resolve order, payment, inventory, shipping and support exceptions with idempotent actions and receipts.

- [Product and pricing](https://commerceexception-api.com/?utm_source=github&utm_medium=developer&utm_campaign=commerce-exception-github&utm_content=readme#pricing)
- [Developer documentation](https://commerceexception-api.com/docs?utm_source=github&utm_medium=developer&utm_campaign=commerce-exception-github&utm_content=readme)
- [Create a free account](https://commerceexception-api.com/signup?utm_source=github&utm_medium=developer&utm_campaign=commerce-exception-github&utm_content=readme)
- [OpenAPI contract](https://commerceexception-api.com/openapi.json)
- [Postman collection](./postman_collection.json)

## Quickstart

### 1. Request a free-key verification email

```bash
curl -X POST https://commerceexception-api.com/v1/keys \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","source":{"source":"github","medium":"developer","campaign":"commerce-exception-github","content":"readme"}}'
```

The service returns `202 Accepted` and sends a one-time claim link. Follow the
email, or exchange its token with `POST /v1/keys/claim`. The API key is shown
once after verification; store it securely. No card is required for the free
sandbox. Current free allowance: **250 exceptions/month**.

### 2. Make the first product call

```bash
curl -X POST https://commerceexception-api.com/v1/exceptions \
  -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"exception":{
        "exceptionId":"case_88213","orderId":"SO-90417","currency":"USD",
        "placedAt":"2026-03-02","observedAt":"2026-03-21",
        "lines":[{"sku":"KB-88","orderedQty":2,"shippedQty":2,
                  "deliveredQty":0,"returnedQty":0,
                  "unitPriceMinor":8900,"onHandQty":0}],
        "payment":{"capturedMinor":17800,"refundedMinor":0},
        "shipment":{"status":"lost","trackingId":"1Z-4471"}}}\'
```

## SDKs

The repository includes dependency-light client files that point to the current
contract and canonical product domain:

- [Python SDK](./sdk/python/commerce_exception.py) — reads `COMMERCE_EXCEPTION_API_KEY`
- [TypeScript SDK](./sdk/typescript/index.ts)

Copy the file you need into your project. The OpenAPI document remains the
authoritative operation and schema contract.

## Authentication and errors

API operations use `Authorization: Bearer <API_KEY>` (or `x-api-key` where
documented). Dashboard-session operations and signed service webhooks are not
callable with a customer API key. Public demo and health operations require no
credential. Errors use a stable `error.code` plus a request ID for support.

## Distribution attribution

The key request above identifies this README with the stable tuple
`github / developer / commerce-exception-github / readme`. The Postman collection and both
SDKs carry their own source metadata. Attribution is used to compare qualified
activation and retained use; it is not evidence that this channel already
performs.

## License

[MIT](./LICENSE)
