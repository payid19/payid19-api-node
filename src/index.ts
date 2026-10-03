import { timingSafeEqual } from 'node:crypto';

import type {
  ApiResponse,
  CallbackPayload,
  CreateInvoiceParams,
  GetInvoicesParams,
} from './types.js';

export type {
  ApiResponse,
  CallbackPayload,
  CreateInvoiceParams,
  GetInvoicesParams,
  Template,
} from './types.js';
export { TEMPLATES } from './types.js';

/** Options for the client constructor. */
export interface Payid19Options {
  /** API base URL. Only worth setting to point at a mock server in tests. */
  apiEndpoint?: string;
  /** Request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** Replacement for `globalThis.fetch`, for tests or a custom agent. */
  fetch?: typeof globalThis.fetch;
}

/**
 * Thrown for every failed call: an API error, a non-2xx status, a transport
 * failure, a timeout, or a body that is not JSON.
 */
export class Payid19Error extends Error {
  /**
   * Why the call failed.
   *
   * - `api_error` — the API answered `status: "error"`; `messages` has the detail
   * - `http_error` — a non-2xx status; `status` has the code
   * - `invalid_json` — the body was not JSON
   * - `empty_response` — the body was empty
   * - `network_error` — the request never completed
   * - `timeout` — the request exceeded the configured timeout
   */
  readonly code:
    | 'api_error'
    | 'http_error'
    | 'invalid_json'
    | 'empty_response'
    | 'network_error'
    | 'timeout';

  /** HTTP status code, when the response carried one. */
  readonly status?: number;

  /** Every message the API returned. API errors usually carry exactly one. */
  readonly messages: string[];

  constructor(
    message: string,
    code: Payid19Error['code'],
    extra: { status?: number; messages?: string[]; cause?: unknown } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = 'Payid19Error';
    this.code = code;
    this.messages = extra.messages ?? [message];
    if (extra.status !== undefined) this.status = extra.status;
  }
}

const DEFAULT_ENDPOINT = 'https://payid19.com/api/v1';
const DEFAULT_TIMEOUT = 30_000;

/**
 * Payid19 API client.
 *
 * ```ts
 * const payid19 = new Payid19('PUBLIC_KEY', 'PRIVATE_KEY');
 * const url = await payid19.createInvoice({ price_amount: 100, order_id: 42 });
 * ```
 *
 * Every method rejects with {@link Payid19Error} rather than returning an
 * error envelope, so a resolved promise always means the call succeeded.
 *
 * @see https://payid19.com/dev
 */
export class Payid19 {
  readonly #publicKey: string;
  readonly #privateKey: string;
  readonly #apiEndpoint: string;
  readonly #timeout: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(publicKey: string, privateKey: string, options: Payid19Options = {}) {
    if (!publicKey || !privateKey) {
      throw new TypeError('Public key and private key cannot be empty.');
    }

    this.#publicKey = publicKey;
    this.#privateKey = privateKey;
    this.#apiEndpoint = (options.apiEndpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.#timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.#fetch = options.fetch ?? globalThis.fetch;

    if (typeof this.#fetch !== 'function') {
      throw new TypeError(
        'No fetch implementation available. Node 18 or newer is required, ' +
          'or pass one as the `fetch` option.',
      );
    }
  }

  /**
   * Creates an invoice and resolves with the hosted payment page URL.
   * Redirect your customer there.
   *
   * With `white_label: 1` the API answers with a JSON coin list instead of a
   * URL; use {@link request} for that so the response is not typed as a URL.
   *
   * @see https://payid19.com/dev/invoices/create_invoice
   */
  async createInvoice(params: CreateInvoiceParams): Promise<string> {
    const body: Record<string, unknown> = { ...params };

    // Accepting an array here saves every caller the same JSON.stringify.
    if (Array.isArray(body['banned_coins'])) {
      body['banned_coins'] = JSON.stringify(body['banned_coins']);
    }

    const message = await this.request<string>('create_invoice', body);

    if (typeof message !== 'string') {
      throw new Payid19Error(
        'Expected a payment page URL but the API returned something else. ' +
          'With white_label: 1 use request() instead.',
        'invalid_json',
      );
    }

    return message;
  }

  /**
   * Retrieves invoices — by `order_id`, most usefully.
   *
   * @see https://payid19.com/dev/invoices/get_invoices
   */
  getInvoices(params: GetInvoicesParams = {}): Promise<unknown> {
    return this.request('get_invoices', params);
  }

  /**
   * Lists the coins and networks that can be used for payment.
   *
   * @see https://payid19.com/dev/tools/get_coins
   */
  getCoins(params: Record<string, unknown> = {}): Promise<unknown> {
    return this.request('get_coins', params);
  }

  /**
   * Converts an amount between a fiat currency and a coin at the current rate.
   *
   * @see https://payid19.com/dev/tools/get_estimate
   */
  getEstimate(params: Record<string, unknown>): Promise<unknown> {
    return this.request('get_estimate', params);
  }

  /**
   * Returns the balance of your account.
   *
   * @see https://payid19.com/dev/withdraws/get_balance
   */
  getBalance(params: Record<string, unknown> = {}): Promise<unknown> {
    return this.request('get_balance', params);
  }

  /**
   * Creates a withdrawal request.
   *
   * @see https://payid19.com/dev/withdraws/create_withdraw
   */
  createWithdraw(params: Record<string, unknown>): Promise<unknown> {
    return this.request('create_withdraw', params);
  }

  /**
   * Checks that a callback really came from Payid19, by comparing the
   * `privatekey` it carries against your own. The comparison is timing-safe.
   *
   * Do not authenticate callbacks by sender IP — they arrive from several
   * addresses. This check is the documented way.
   *
   * ```ts
   * app.post('/payment/callback', (req, res) => {
   *   if (!payid19.verifyCallback(req.body)) return res.sendStatus(403);
   *   // ...mark the order paid, idempotently
   *   res.sendStatus(200);
   * });
   * ```
   */
  verifyCallback(payload: CallbackPayload | { privatekey?: unknown } | null | undefined): boolean {
    const received = payload?.privatekey;
    if (typeof received !== 'string') return false;

    const a = Buffer.from(received);
    const b = Buffer.from(this.#privateKey);

    // timingSafeEqual throws on a length mismatch, which would itself leak the
    // length, so compare equal-length digests of the two values instead.
    if (a.length !== b.length) {
      const padded = Buffer.alloc(Math.max(a.length, b.length));
      const other = Buffer.alloc(padded.length);
      a.copy(padded);
      b.copy(other);
      timingSafeEqual(padded, other);
      return false;
    }

    return timingSafeEqual(a, b);
  }

  /**
   * Calls any endpoint and resolves with its `message` payload.
   *
   * The typed methods above cover the documented endpoints; this is the way
   * to reach a parameter or endpoint added after this library was published,
   * without waiting for a release.
   */
  async request<T = unknown>(command: string, params: Record<string, unknown> = {}): Promise<T> {
    const form = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      form.set(key, typeof value === 'string' ? value : String(value));
    }

    form.set('public_key', this.#publicKey);
    form.set('private_key', this.#privateKey);

    const url = `${this.#apiEndpoint}/${command.replace(/^\/+/, '')}`;

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form,
        signal: AbortSignal.timeout(this.#timeout),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
      throw new Payid19Error(
        timedOut
          ? `Request to ${command} timed out after ${this.#timeout}ms.`
          : `Request to ${command} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        timedOut ? 'timeout' : 'network_error',
        { cause },
      );
    }

    const text = await response.text();

    if (text.length === 0) {
      throw new Payid19Error('API returned an empty response.', 'empty_response', {
        status: response.status,
      });
    }

    let parsed: ApiResponse<T>;
    try {
      parsed = JSON.parse(text) as ApiResponse<T>;
    } catch (cause) {
      // An error status with an unparseable body is an HTTP failure first and
      // foremost; reporting it as bad JSON would hide the status code.
      if (!response.ok) {
        throw new Payid19Error(
          `API returned an unexpected HTTP status code: ${response.status}`,
          'http_error',
          { status: response.status, cause },
        );
      }
      throw new Payid19Error(
        `API returned invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        'invalid_json',
        { status: response.status, cause },
      );
    }

    // Errors come back with HTTP 421 and a message array, so the envelope is
    // checked before the status code to surface the readable reason.
    if (parsed?.status === 'error') {
      const messages = Array.isArray(parsed.message)
        ? parsed.message.map(String)
        : [String(parsed.message)];

      throw new Payid19Error(messages[0] ?? 'The API returned an error.', 'api_error', {
        status: response.status,
        messages,
      });
    }

    if (!response.ok) {
      throw new Payid19Error(
        `API returned an unexpected HTTP status code: ${response.status}`,
        'http_error',
        { status: response.status },
      );
    }

    return parsed.message;
  }
}
