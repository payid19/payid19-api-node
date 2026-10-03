# Payid19 Node.js API Library

Accept USDT and cryptocurrency payments in your Node.js application using
[Payid19](https://payid19.com).

TypeScript types are included, there are no runtime dependencies, and every
call rejects with a typed error instead of returning an error envelope — so a
resolved promise always means the call succeeded.

## Requirements

- Node.js >= 18 (the library uses the built-in `fetch`)

## Installation

```bash
npm install payid19-api-node
```

## Getting Started

1. Create an account at [payid19.com](https://payid19.com)
2. Open [Settings](https://payid19.com/settings) and copy your **Public Key**
   and **Private Key**
3. Create a client

```js
const { Payid19 } = require('payid19-api-node');

const payid19 = new Payid19(process.env.PAYID19_PUBLIC_KEY, process.env.PAYID19_PRIVATE_KEY);
```

```ts
// TypeScript / ESM
import { Payid19 } from 'payid19-api-node';

const payid19 = new Payid19(publicKey, privateKey);
```

## Usage

### Create an Invoice

Resolves with the hosted payment page URL — redirect your customer there.

> Full parameter list: [payid19.com/dev/invoices/create_invoice](https://payid19.com/dev/invoices/create_invoice)

```ts
const url = await payid19.createInvoice({
  price_amount: 100,
  price_currency: 'USD',
  order_id: 42,
  email: 'customer@example.com',
  title: 'Order #42',
  template: 'slate',
  success_url: 'https://yoursite.com/payment/success',
  cancel_url: 'https://yoursite.com/payment/cancel',
  callback_url: 'https://yoursite.com/payment/callback',
  // test: 1,  // completes itself in seconds, no real payment
});

res.redirect(url);
```

#### Parameters

Keys are spelled exactly as the API documents them, so the
[API reference](https://payid19.com/dev/invoices/create_invoice) maps one to
one onto the TypeScript type with nothing in between to drift out of date.

Only `price_amount` is required.

| Parameter | Type | Notes |
|---|---|---|
| `price_amount` | number | **Required.** Price in `price_currency`. Minimum `0.0001`. |
| `price_currency` | string | Defaults to `USD`. EUR, GBP, TRY and 150+ local currencies are accepted — conversion to crypto happens when the customer opens the page. |
| `add_fee_to_price` | `1` | Passes the platform commission on to the customer, so you receive the full `price_amount`. Applied automatically below ~0.20 USD. |
| `margin_ratio` | number | Underpayment tolerance in USDT. With `1` on a 5 USDT invoice, 4 USDT still completes the payment. Minimum `0.01`. Wallets often deduct the network fee from the amount the customer types, which is what this absorbs. |
| `order_id` | string \| number | Your order reference, echoed back in the callback and searchable via `getInvoices()`. Max 100 chars. |
| `merchant_id` | string \| number | Your merchant reference, echoed back in the callback. Max 150 chars. |
| `customer_id` | number | Your customer reference, echoed back in the callback. Max 11 digits. |
| `email` | string | Buyer's email. If omitted, the customer enters it on the payment page. |
| `title` | string | Shown at the top of the payment page. Max 150 chars. |
| `description` | string | Shown under the title. Up to 300 chars accepted, only the first 180 are stored and displayed. |
| `banned_coins` | string[] | Coins to hide. `['BTC','ETH']` hides them everywhere; `['USDT-ERC20']` hides only that network. Pass an array — the library encodes it. |
| `callback_url` | string | Where the payment result is POSTed. Must be a public domain — no IPs, no localhost. Max 300 chars. |
| `success_url` | string | Redirect after a successful payment. Cosmetic only — see [Payment Callback](#payment-callback). Max 300 chars. |
| `cancel_url` | string | Redirect if the customer cancels. Max 300 chars. |
| `template` | `Template` | Payment page design — see below. |
| `test` | `1` | Creates a test invoice that completes itself within seconds, callback included, with no real payment. |
| `white_label` | `1` | Returns a JSON coin list instead of a page URL. Use `request()` for this — see [White Label](#white-label). |
| `referral` | string \| number | Your 10-digit referral ID. Earns you half of the Payid19 commission on every payment the invoice receives. |
| `expiration_date` | number | Accepted for backwards compatibility only. Invoices are valid for **24 hours** regardless of the value sent. |

### Payment Page Templates

The hosted payment page comes in four designs. The returned URL points at the
one you pick, e.g. `https://payid19.com/invoice/{alias}/paper`.

- `classic` — the default page, used when `template` is omitted
- `slate`
- `paper`
- `mint`

Every design supports the same coins, networks and underpayment handling —
only the look differs. In TypeScript the value is checked at compile time, so
a typo fails the build rather than the API call:

```ts
import { Payid19, TEMPLATES, type Template } from 'payid19-api-node';

await payid19.createInvoice({ price_amount: 100, template: 'mint' });
await payid19.createInvoice({ price_amount: 100, template: 'mnit' });
//                                               ~~~~~~~~ not assignable to Template

TEMPLATES; // readonly ['classic', 'slate', 'paper', 'mint']
```

### Get Invoices

> Full parameter list: [payid19.com/dev/invoices/get_invoices](https://payid19.com/dev/invoices/get_invoices)

```ts
const invoices = await payid19.getInvoices({ order_id: 42 });
```

### Coins and Estimates

> Parameters: [get_coins](https://payid19.com/dev/tools/get_coins) &middot; [get_estimate](https://payid19.com/dev/tools/get_estimate)

```ts
const coins = await payid19.getCoins();
const estimate = await payid19.getEstimate({ /* see the docs above */ });
```

### Withdrawals

> Parameters: [get_balance](https://payid19.com/dev/withdraws/get_balance) &middot; [create_withdraw](https://payid19.com/dev/withdraws/create_withdraw)

```ts
const balance = await payid19.getBalance();
const withdraw = await payid19.createWithdraw({ /* see the docs above */ });
```

### White Label

With `white_label: 1` the API answers with a JSON coin list instead of a
payment page URL, so you can build the checkout under your own brand. Because
the response is not a URL, reach it through `request()`:

```ts
const coins = await payid19.request('create_invoice', {
  price_amount: 100,
  order_id: 42,
  white_label: 1,
});
```

> [payid19.com/dev/invoices/white_label](https://payid19.com/dev/invoices/white_label)

### Anything not wrapped yet

`request()` calls any endpoint with any parameters and resolves with its
`message` payload — the way to use something the API added after this release,
without waiting for a new version:

```ts
const result = await payid19.request('some_new_endpoint', { foo: 'bar' });
```

## Payment Callback

When an invoice is **paid**, Payid19 POSTs a JSON body to your `callback_url`.
Callbacks are sent for completed payments only: receiving one means the invoice
is paid. Pending and expired invoices produce nothing.

`verifyCallback()` performs the documented check — a timing-safe comparison of
the `privatekey` in the payload against your own:

```ts
import express from 'express';

const app = express();
app.use(express.json());

app.post('/payment/callback', (req, res) => {
  if (!payid19.verifyCallback(req.body)) {
    return res.sendStatus(403);
  }

  // Payment confirmed — mark req.body.order_id as paid.
  // Keep this idempotent: a callback can be delivered more than once.

  res.sendStatus(200);
});
```

The payload carries `privatekey`, Payid19's invoice `id`, your `order_id` /
`merchant_id` / `customer_id` unchanged, the requested `price_amount` and
`price_currency`, the `amount` and `amount_currency` actually paid, and a full
snapshot of the invoice — so a follow-up API call is rarely needed. The
`CallbackPayload` type describes it.

Four things worth getting right:

- **Verify `privatekey`.** Do *not* filter by sender IP — callbacks arrive from
  several addresses.
- **Respond with 2xx.** A non-2xx response is retried, up to 3 delivery
  attempts in total.
- **Be idempotent.** Because of those retries the same callback can arrive more
  than once; marking an already-paid order as paid again must be harmless.
- **Never treat `success_url` as proof of payment** — a customer can open that
  URL by hand. The callback is the single source of truth.

## Error Handling

Every method rejects with a `Payid19Error` whose `code` says what went wrong:

| `code` | Meaning |
|---|---|
| `api_error` | The API answered `status: "error"`. `messages` has the detail, `status` is usually 421. |
| `http_error` | A non-2xx status with no usable error body. |
| `invalid_json` | The body was not JSON. |
| `empty_response` | The body was empty. |
| `network_error` | The request never completed. `cause` has the original error. |
| `timeout` | The request exceeded the timeout (30s by default). |

```ts
import { Payid19Error } from 'payid19-api-node';

try {
  const url = await payid19.createInvoice({ price_amount: 100 });
} catch (err) {
  if (err instanceof Payid19Error) {
    console.error(err.code, err.messages);
  } else {
    throw err;
  }
}
```

## Options

```ts
new Payid19(publicKey, privateKey, {
  timeout: 30_000,                            // ms, default 30000
  apiEndpoint: 'https://payid19.com/api/v1',  // only worth changing for a mock server
  fetch: myFetch,                             // custom fetch, e.g. with a proxy agent
});
```

## Other Languages

- PHP — [payid19/payid19-api-php](https://github.com/payid19/payid19-api-php)
- Plugins and wrappers — [payid19.com/dev/plugins/woocommerce_plugin](https://payid19.com/dev/plugins/woocommerce_plugin)

## License

MIT
