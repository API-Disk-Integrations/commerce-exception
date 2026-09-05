# Commerce Exception API TypeScript SDK

Detect and resolve order, payment, inventory, shipping and support exceptions with idempotent actions and receipts.

This package is the zero-runtime-dependency TypeScript/JavaScript client from
the audited public integration repository. It supports ESM and CommonJS on
Node.js 18 or newer. Import and construction perform no network request.

## Install

```sh
npm install commerce-exception
```

## Authenticated client

```ts
import { CommerceException } from 'commerce-exception'

const client = new CommerceException({
  apiKey: process.env.COMMERCE_EXCEPTION_API_KEY,
})
```

Never place an API key in browser code, source control, logs, or examples.
Requesting a sandbox key is an email-verification and claim flow; it does not
return a key in the initial response.

- [Product, docs, demo, pricing, privacy, and terms](https://commerceexception-api.com/?utm_source=npm&utm_medium=package&utm_campaign=commerce-exception&utm_content=readme)
- [Source and changelog](https://github.com/API-Disk-Integrations/commerce-exception)
- [Issues](https://github.com/API-Disk-Integrations/commerce-exception/issues)

Security reports must not be filed in a public issue. Use the repository's
private security-reporting path after the owner confirms it is enabled.

MIT licensed. The API service remains governed by the product site's terms.
