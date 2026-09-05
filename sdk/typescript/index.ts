/**
 * Commerce Exception Resolution API client.
 *
 * Zero dependencies — uses the platform `fetch`, so it runs in Node 18+, Deno,
 * Bun and Cloudflare Workers without a bundler argument.
 *
 * NOT the browser: these endpoints need an API key and deliberately do not
 * support CORS. A key in front-end JavaScript is a published key.
 *
 * ```ts
 * const client = new CommerceException()              // reads COMMERCE_EXCEPTION_API_KEY
 * const client = new CommerceException({ apiKey: 'sp_live_…', baseUrl: 'https://…' })
 * ```
 *
 * Two things to know before you integrate.
 *
 * 1. Every amount is an INTEGER number of minor units (cents). A fractional
 *    price is rejected by the API rather than rounded.
 * 2. Each action carries an `idempotencyKey` derived from the remedy — the
 *    order, exception type, action kind, currency, amount and subject — and NOT
 *    from the request. Pass it straight to your payment processor as its
 *    idempotency key. Replaying the same exception produces the same key, so a
 *    retried batch cannot refund the customer twice.
 */

/**
 * Filled in at release with the deployed origin. Until then the client refuses
 * to guess a hostname: pass `baseUrl` or set COMMERCE_EXCEPTION_BASE_URL. A
 * hard-coded wrong hostname in a published example is worse than no default.
 */
export const DEFAULT_BASE_URL = 'https://commerceexception-api.com'

export type OrderStatus = 'open' | 'cancelled' | 'completed'
export type ChargeStatus = 'captured' | 'authorized' | 'refunded' | 'voided' | 'failed'
export type ShipmentStatus = 'not_shipped' | 'in_transit' | 'delivered' | 'lost' | 'returned_to_sender'
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'none'

/** Branch on these rather than on the human-readable `detail`. */
export type ExceptionType =
  | 'duplicate_charge'
  | 'payment_captured_not_fulfilled'
  | 'shipment_lost_in_transit'
  | 'refund_owed_not_issued'
  | 'return_received_not_refunded'
  | 'inventory_oversold'
  | 'partial_shipment_unbilled_remainder'
  | 'return_not_restocked'
  | 'delivery_overdue'
  | 'no_exception'

export type ActionKind = 'refund' | 'recapture' | 'reship' | 'restock' | 'credit' | 'escalate' | 'no_action'

export type ActionReason =
  | 'duplicate_capture_returned'
  | 'goods_not_received'
  | 'goods_returned_by_customer'
  | 'stock_returned_not_restocked'
  | 'unfulfillable_stock_shortfall'
  | 'shipment_declared_lost'
  | 'stock_available_for_reship'
  | 'overheld_balance_returned'
  | 'remainder_never_billed'
  | 'carrier_exception_needs_contact'
  | 'above_auto_refund_cap'
  | 'refund_window_closed'
  | 'no_authorization_headroom'
  | 'refund_ceiling_reached'
  | 'nothing_to_recover'

export interface OrderLine {
  sku: string
  description?: string
  orderedQty: number
  /** Cannot exceed orderedQty. */
  shippedQty: number
  /** Cannot exceed shippedQty. Nothing arrives that never left. */
  deliveredQty: number
  /** Cannot exceed shippedQty. Overlaps deliveredQty: a unit delivered then sent back counts in both. */
  returnedQty: number
  /** Returned units already back in sellable stock. Defaults to 0. */
  restockedQty?: number
  /** Integer minor units, in the case currency. */
  unitPriceMinor: number
  /** Without it an oversell cannot be detected and a refund cannot be upgraded to a reship. */
  onHandQty?: number
}

export interface Charge {
  chargeId: string
  amountMinor: number
  /** Minute-granular. Duplicate detection compares these directly. */
  capturedAt: string
  status: ChargeStatus
  /** Must equal the case currency. A charge in another currency is rejected, not converted. */
  currency?: string
}

export interface PaymentState {
  capturedMinor: number
  /** Cannot exceed capturedMinor. */
  refundedMinor: number
  /** Authorized and NOT captured. The only headroom a recapture may use. */
  authorizedMinor?: number
  /** Last UTC day the processor accepts a refund. Past it, money owed becomes store credit. */
  refundableUntil?: string
  charges?: Charge[]
}

export interface ShipmentState {
  status: ShipmentStatus
  carrier?: string
  trackingId?: string
  lastScanAt?: string
  promisedBy?: string
}

/** Every field optional; every default is documented and echoed back on the response. */
export interface ResolutionPolicy {
  fulfilmentSlaDays?: number
  transitStaleDays?: number
  duplicateWindowMinutes?: number
  escalateAfterDays?: number
  /** Above this a payout becomes an `escalate` carrying the proposed amount. No default. */
  autoRefundCapMinor?: number
}

export interface ExceptionInput {
  /** Your ticket id. Deliberately NOT part of the idempotency key. */
  exceptionId: string
  /** The order the money moves against. This IS part of the idempotency key. */
  orderId: string
  currency: string
  placedAt: string
  /** Required. Every deadline is measured against it, so a replay reproduces the same verdict. */
  observedAt: string
  orderStatus?: OrderStatus
  lines: OrderLine[]
  payment: PaymentState
  shipment?: ShipmentState
  policy?: ResolutionPolicy
  metadata?: Record<string, string>
}

export interface Ledger {
  currency: string
  orderedValueMinor: number
  shippedValueMinor: number
  deliveredValueMinor: number
  returnedValueMinor: number
  inTransitValueMinor: number
  keptValueMinor: number
  unshippedValueMinor: number
  unfulfillableValueMinor: number
  /** Value of goods shipped, not returned, and not aboard a shipment that will never arrive. */
  entitledToHoldMinor: number
  capturedMinor: number
  refundedMinor: number
  /** Captured minus refunded. The most that can ever be refunded. */
  netCapturedMinor: number
  authorizedMinor: number
  duplicateCaptureMinor: number
  /** Held beyond entitledToHoldMinor. Payouts are allocated out of this, in priority order. */
  overholdMinor: number
  shortfallMinor: number
  refundCeilingMinor: number
  unshippedUnits: number
  unrestockedUnits: number
}

export interface Finding {
  type: ExceptionType
  severity: Severity
  /** Money at issue before any ceiling is applied. */
  amountMinor: number
  units?: number
  detail: string
  evidence: string[]
  ageDays: number
  agedUp: boolean
}

export interface ResolutionAction {
  kind: ActionKind
  exceptionType: ExceptionType
  /** What actually moves, after every ceiling. */
  amountMinor: number
  currency: string
  claimedMinor: number
  /** True when the amount was reduced to fit money that actually exists. */
  clipped: boolean
  units?: number
  reason: ActionReason
  detail: string
  /** Pass this to your processor as its idempotency key. */
  idempotencyKey: string
}

export interface Receipt {
  exceptionId: string
  orderId: string
  currency: string
  decidedAt: string
  findingCount: number
  actionCount: number
  netCapturedMinor: number
  refundCeilingMinor: number
  /** Never exceeds refundCeilingMinor. */
  moneyOutMinor: number
  moneyInMinor: number
  evidence: string[]
  digest: string
}

export interface Resolution {
  exceptionId: string
  orderId: string
  currency: string
  observedAt: string
  evaluatedAt: string
  orderStatus: OrderStatus
  ageDays: number
  severity: Severity
  policy: Required<Omit<ResolutionPolicy, 'autoRefundCapMinor'>> & { autoRefundCapMinor: number | null }
  ledger: Ledger
  /** Every exception on the order, not just the first. Never empty. */
  findings: Finding[]
  /** In execution order, which is also the order money was allocated. Never empty. */
  actions: ResolutionAction[]
  totals: {
    recoverableMinor: number
    refundMinor: number
    creditMinor: number
    escalatedPayoutMinor: number
    recaptureMinor: number
    pendingRecaptureMinor: number
    restockUnits: number
  }
  receipt: Receipt
  warnings: string[]
}

export type ApiErrorCode =
  | 'invalid_api_key' | 'missing_api_key' | 'quota_exceeded' | 'rate_limited'
  | 'invalid_request' | 'not_found' | 'method_not_allowed' | 'payload_too_large'
  | 'conflict' | 'internal_error'

/**
 * Thrown for any non-2xx response.
 *
 * NOT thrown when a resolution comes back `no_exception` — that is a
 * successful answer to a legitimate question. On a 400, `details.path` names
 * the exact field that failed validation.
 */
export class ApiError extends Error {
  // Declared as fields rather than constructor parameter properties: those are
  // unsupported by strip-only TypeScript runtimes (Node --experimental-strip-types),
  // and an SDK should run without a build step.
  readonly status: number
  readonly code: ApiErrorCode | 'unknown'
  // Declared as `| undefined` rather than optional: under
  // exactOptionalPropertyTypes an optional property will not accept an
  // explicit undefined, and these are always assigned in the constructor.
  readonly requestId: string | undefined
  readonly details: unknown

  constructor(status: number, code: ApiErrorCode | 'unknown', message: string, requestId?: string, details?: unknown) {
    super(`[${status} ${code}] ${message}`)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

export interface ClientOptions {
  apiKey?: string
  /** Required unless COMMERCE_EXCEPTION_BASE_URL is set. The client will not guess a hostname. */
  baseUrl?: string
  /** Milliseconds. Default 30000. */
  timeoutMs?: number
  fetch?: typeof fetch
}

/** Optional acquisition metadata. Invalid values are ignored by the service. */
export interface KeySource {
  source?: string
  medium?: string
  campaign?: string
  content?: string
}

/** Actions of the given kinds, in execution order. */
export const actionsOf = (resolution: Resolution, ...kinds: ActionKind[]): ResolutionAction[] =>
  resolution.actions.filter((a) => kinds.includes(a.kind))

export class CommerceException {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: ClientOptions = {}) {
    const env = (globalThis as any).process?.env ?? {}
    const base = options.baseUrl ?? env.COMMERCE_EXCEPTION_BASE_URL ?? DEFAULT_BASE_URL
    if (!base) {
      throw new Error(
        'No base URL. Pass { baseUrl } or set COMMERCE_EXCEPTION_BASE_URL to the deployed origin shown on the service\'s landing page.',
      )
    }
    const key = options.apiKey ?? env.COMMERCE_EXCEPTION_API_KEY
    if (!key) {
      throw new Error(
        'No API key. Pass { apiKey } or set COMMERCE_EXCEPTION_API_KEY. Request a free key verification email: POST ' + base + '/v1/keys',
      )
    }
    this.apiKey = key
    this.baseUrl = base.replace(/\/$/, '')
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  private async request(method: string, path: string, body?: unknown, auth = true): Promise<any> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(this.baseUrl + path, {
        method,
        signal: controller.signal,
        headers: {
          ...(auth ? { authorization: `Bearer ${this.apiKey}` } : {}),
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
      const text = await res.text()
      const json = text ? JSON.parse(text) : {}
      if (!res.ok) {
        const e = json?.error ?? {}
        throw new ApiError(res.status, e.code ?? 'unknown', e.message ?? text.slice(0, 200), e.requestId, e.details)
      }
      return json
    } finally {
      clearTimeout(timer)
    }
  }

  /** Liveness and deployed version. Does not require a key. */
  async health(): Promise<{ ok: boolean; product: string; version: string }> {
    return this.request('GET', '/health', undefined, false)
  }

  /**
   * Classify one order's state, or up to 100.
   *
   * Billed one unit per exception submitted, however many findings and actions
   * it produces.
   */
  async resolve(
    exception: ExceptionInput | ExceptionInput[],
  ): Promise<{ count: number; actionable: number; resolutions: Resolution[]; requestId: string }> {
    return this.request('POST', '/v1/exceptions', Array.isArray(exception) ? { exceptions: exception } : { exception })
  }

  /** The real engine with no key: one exception, at most 10 lines and 10 charges. */
  async demoResolve(exception: ExceptionInput): Promise<{ resolution: Resolution; requestId: string }> {
    return this.request('POST', '/v1/demo/resolve', { exception }, false)
  }

  /** Every exception type, action kind, reason code and policy default, with meanings. */
  async exceptionTypes(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/exception-types', undefined, false)
  }

  /** Request a free sandbox key; this emails a claim token. Claiming returns the key once. */
  static async createKey(email: string, opts: { baseUrl?: string; name?: string; source?: KeySource } = {}): Promise<any> {
    const env = (globalThis as any).process?.env ?? {}
    const base = opts.baseUrl ?? env.COMMERCE_EXCEPTION_BASE_URL ?? DEFAULT_BASE_URL
    if (!base) throw new Error('No base URL. Pass { baseUrl } or set COMMERCE_EXCEPTION_BASE_URL.')
    const res = await fetch(base.replace(/\/$/, '') + '/v1/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        ...(opts.name ? { name: opts.name } : {}),
        source: opts.source ?? { source: 'sdk', medium: 'typescript' },
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'unknown', json?.error?.message ?? 'failed', json?.error?.requestId)
    return json
  }
}

export default CommerceException

// ---8<--- BEGIN GENERATED BY tools/gen-sdk.mjs — DO NOT EDIT BELOW ---8<---
// Everything between these markers is written from openapi.json. Change the
// service, regenerate the contract, then re-run `npm run gen:sdk`.

/** The contract this SDK was generated from. */
export const API_TITLE = "Commerce Exception API"
export const API_VERSION = "1.0.0"
/** The origin the published contract names. `DEFAULT_BASE_URL` resolves to this unless overridden. */
export const API_BASE_URL = "https://commerceexception-api.com"

/**
 * Every `error.code` the contract publishes.
 *
 * The runtime companion to the `ApiErrorCode` union: a union is erased at
 * compile time, so a caller wanting to test an unknown string against the
 * documented set had nothing to test it with.
 */
export const ERROR_CODES = ["invalid_api_key", "missing_api_key", "quota_exceeded", "rate_limited", "invalid_request", "not_found", "method_not_allowed", "payload_too_large", "conflict", "internal_error"] as const

/** One published operation, exactly as the contract describes it. */
export interface OperationDescriptor {
  readonly operationId: string
  readonly method: string
  readonly path: string
  readonly summary: string
  /** True when the operation requires an API key. False does NOT mean public — see `authKind`. */
  readonly auth: boolean
  /**
   * The credential the operation actually takes.
   *
   * `api_key` — the bearer token this client sends.
   * `session` — the dashboard session cookie, plus `x-csrf-token` on writes.
   *             An API key is REFUSED: these endpoints change what you are
   *             billed and read your payment history, and a key that lives
   *             in CI must not reach them. Call them from the signed-in
   *             dashboard, not from this SDK.
   * `signature` — machine-to-machine; not callable by API consumers.
   * `public` — no credential at all.
   */
  readonly authKind: 'api_key' | 'session' | 'signature' | 'public'
  readonly pathParams: readonly string[]
  readonly queryParams: readonly string[]
  readonly requiredBodyFields: readonly string[]
  readonly successStatus: number | null
  /** Property names of the documented 2xx body. A field absent here is a field the service does not promise. */
  readonly responseFields: readonly string[]
}

/**
 * The published surface, generated. Ships with the client so an integration
 * can assert against the contract instead of against a changelog.
 */
export const OPERATIONS: readonly OperationDescriptor[] = [
  {
    operationId: "get/",
    method: "GET",
    path: "/",
    summary: "Service index — endpoints, auth and error format",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "postApiBillingWebhook",
    method: "POST",
    path: "/api/billing/webhook",
    summary: "Square billing events, forwarded by the shared hub",
    auth: false,
    authKind: "signature",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "getHealth",
    method: "GET",
    path: "/health",
    summary: "Liveness and deployed version",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: [],
  },
  {
    operationId: "postV1Checkout",
    method: "POST",
    path: "/v1/checkout",
    summary: "Start a hosted Square checkout for a paid tier",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["tier"],
    successStatus: 200,
    responseFields: ["checkoutUrl", "tier", "sku", "requestId"],
  },
  {
    operationId: "postV1DemoResolve",
    method: "POST",
    path: "/v1/demo/resolve",
    summary: "Public demo — resolve one exception without a key",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["exception"],
    successStatus: 200,
    responseFields: ["resolution", "requestId"],
  },
  {
    operationId: "getV1ExceptionTypes",
    method: "GET",
    path: "/v1/exception-types",
    summary: "Every exception type, action kind and reason code the engine emits",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["exceptionTypes", "severities", "actionKinds", "actionReasons", "policyDefaults", "refundPriority", "idempotency"],
  },
  {
    operationId: "postV1Exceptions",
    method: "POST",
    path: "/v1/exceptions",
    summary: "Classify commerce exceptions and return an idempotent action plan",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["count", "actionable", "resolutions", "requestId"],
  },
  {
    operationId: "getV1Invoices",
    method: "GET",
    path: "/v1/invoices",
    summary: "Every invoice issued against this account, newest first (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "count", "note", "invoices", "requestId"],
  },
  {
    operationId: "getV1Keys",
    method: "GET",
    path: "/v1/keys",
    summary: "List your API keys for this API",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "accountId", "keys", "requestId"],
  },
  {
    operationId: "postV1Keys",
    method: "POST",
    path: "/v1/keys",
    summary: "Request a free sandbox API key (sends a verification email)",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["email"],
    successStatus: 202,
    responseFields: ["status", "email", "expiresAt", "next", "message", "requestId"],
  },
  {
    operationId: "postV1KeysIdRevoke",
    method: "POST",
    path: "/v1/keys/{id}/revoke",
    summary: "Revoke one of your API keys",
    auth: true,
    authKind: "api_key",
    pathParams: ["id"],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["id", "status", "message", "requestId"],
  },
  {
    operationId: "postV1KeysIdRotate",
    method: "POST",
    path: "/v1/keys/{id}/rotate",
    summary: "Replace one of your API keys with a new secret",
    auth: true,
    authKind: "api_key",
    pathParams: ["id"],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 201,
    responseFields: ["apiKey", "keyId", "replaced", "product", "quotaPerPeriod", "plan", "warning", "requestId"],
  },
  {
    operationId: "postV1KeysClaim",
    method: "POST",
    path: "/v1/keys/claim",
    summary: "Exchange an emailed claim token for the API key",
    auth: false,
    authKind: "public",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["token"],
    successStatus: 201,
    responseFields: ["apiKey", "keyId", "product", "quotaPerPeriod", "plan", "warning", "usage", "requestId"],
  },
  {
    operationId: "getV1Payments",
    method: "GET",
    path: "/v1/payments",
    summary: "Every payment attempted against this account and how it went (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "count", "note", "payments", "requestId"],
  },
  {
    operationId: "getV1Subscription",
    method: "GET",
    path: "/v1/subscription",
    summary: "Your current plan, billing window and available changes (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "subscribed", "status", "plan", "pendingPlan", "planChangesGoThrough", "baseFeeOwner", "cancellation", "tiers", "requestId"],
  },
  {
    operationId: "postV1SubscriptionCancel",
    method: "POST",
    path: "/v1/subscription/cancel",
    summary: "Cancel this plan and end metered access (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["canceled", "canceledAt", "entitlement", "money", "finalInvoice", "requestId"],
  },
  {
    operationId: "postV1SubscriptionPlan",
    method: "POST",
    path: "/v1/subscription/plan",
    summary: "Upgrade or downgrade to another plan (dashboard session required)",
    auth: false,
    authKind: "session",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: ["planId"],
    successStatus: 200,
    responseFields: ["changed", "direction", "from", "to", "entitlement", "billing", "requestId"],
  },
  {
    operationId: "getV1Usage",
    method: "GET",
    path: "/v1/usage",
    summary: "Your consumption and remaining allowance for this period",
    auth: true,
    authKind: "api_key",
    pathParams: [],
    queryParams: [],
    requiredBodyFields: [],
    successStatus: 200,
    responseFields: ["product", "tier", "status", "unit", "period", "included", "used", "ceiling", "remaining", "overageSoFarMinor", "spendCapMinor", "requestId"],
  },
]
// ---8<--- END GENERATED BY tools/gen-sdk.mjs ---8<---
