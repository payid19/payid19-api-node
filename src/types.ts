/** Designs available for the hosted payment page. */
export const TEMPLATES = ['classic', 'slate', 'paper', 'mint'] as const;

/**
 * Design of the hosted payment page. The payment URL returned by
 * `createInvoice` points at the chosen design, e.g.
 * `https://payid19.com/invoice/{alias}/paper`.
 */
export type Template = (typeof TEMPLATES)[number];

/**
 * Parameters accepted by `createInvoice`.
 *
 * Keys are spelled exactly as the API documents them, so
 * https://payid19.com/dev/invoices/create_invoice maps one to one onto this
 * type with nothing in between to drift out of date.
 */
export interface CreateInvoiceParams {
  /** Price in `price_currency`. Minimum 0.0001. */
  price_amount: number;
  /**
   * Pricing currency. Defaults to USD; EUR, GBP, TRY and 150+ local
   * currencies are accepted, and the conversion to crypto happens when the
   * customer opens the payment page.
   */
  price_currency?: string;
  /**
   * `1` passes the platform commission on to the customer, so you receive the
   * full `price_amount`. Applied automatically below roughly 0.20 USD.
   */
  add_fee_to_price?: 1;
  /**
   * Underpayment tolerance in USDT. With `1` on a 5 USDT invoice, 4 USDT
   * still completes the payment. Minimum 0.01. Wallets often deduct the
   * network fee from the amount the customer types, which is what this
   * absorbs.
   */
  margin_ratio?: number;
  /** Your order reference. Echoed back in the callback. Max 100 chars. */
  order_id?: string | number;
  /** Your merchant reference. Echoed back in the callback. Max 150 chars. */
  merchant_id?: string | number;
  /** Your customer reference. Echoed back in the callback. Max 11 digits. */
  customer_id?: number;
  /** Buyer's email. If omitted, the customer enters it on the payment page. */
  email?: string;
  /** Shown at the top of the payment page. Max 150 chars. */
  title?: string;
  /**
   * Shown under the title. Up to 300 characters are accepted, but only the
   * first 180 are stored and displayed.
   */
  description?: string;
  /**
   * Coins to hide, as a JSON string. `["BTC","ETH"]` hides them on every
   * network; `["USDT-ERC20"]` hides only that network. Pass an array and the
   * library encodes it for you.
   */
  banned_coins?: string | string[];
  /**
   * Where the payment result is POSTed. Must be a public domain — not an IP
   * address and not localhost. Max 300 chars.
   */
  callback_url?: string;
  /**
   * Redirect after a successful payment. Cosmetic only: a customer can open
   * this URL by hand, so never treat reaching it as proof of payment.
   */
  success_url?: string;
  /** Redirect if the customer cancels on the payment page. Max 300 chars. */
  cancel_url?: string;
  /** Design of the payment page. Omit to keep the classic page. */
  template?: Template;
  /**
   * `1` creates a test invoice: it completes itself within seconds, callback
   * included, with no real payment.
   */
  test?: 1;
  /**
   * `1` returns a JSON coin list instead of a payment page URL, so you can
   * build the checkout under your own brand.
   */
  white_label?: 1;
  /**
   * Your 10-digit referral ID. Earns you half of the Payid19 commission on
   * every payment the invoice receives.
   */
  referral?: string | number;
  /**
   * Accepted for backwards compatibility only. Invoices are valid for 24
   * hours regardless of the value sent.
   */
  expiration_date?: number;
}

/** Parameters accepted by `getInvoices`. */
export interface GetInvoicesParams {
  order_id?: string | number;
  [key: string]: unknown;
}

/**
 * The JSON body Payid19 POSTs to your `callback_url` when an invoice is paid.
 *
 * Callbacks are sent for completed payments only: receiving one means the
 * invoice is paid. Pending and expired invoices produce nothing.
 */
export interface CallbackPayload {
  /**
   * Your private key. Compare it against your own copy — a match is what
   * proves the callback came from Payid19.
   */
  privatekey?: string;
  /** Payid19's invoice ID. */
  id?: number;
  /** The references you set when creating the invoice, echoed back. */
  order_id?: string;
  merchant_id?: string;
  customer_id?: number;
  /** The invoice amount and currency you requested. */
  price_amount?: string | number;
  price_currency?: string;
  /** What the customer actually paid, in the coin they picked. */
  amount?: string | number;
  amount_currency?: string;
  user_id?: number;
  email?: string;
  add_fee_to_price?: number;
  title?: string;
  description?: string;
  ref_url?: string;
  cancel_url?: string;
  success_url?: string;
  callback_url?: string;
  ip?: string;
  test?: number;
  created_at?: string;
  expiration_date?: string | number;
  [key: string]: unknown;
}

/** The envelope every endpoint responds with. */
export interface ApiResponse<T = unknown> {
  status: 'success' | 'error';
  message: T;
}
