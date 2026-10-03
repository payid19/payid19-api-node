'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Payid19, Payid19Error, TEMPLATES } = require('../dist/index.js');

/** A fetch stub that records the call and replies with what the test wants. */
function stubFetch(reply) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init.body.toString() });
    if (typeof reply === 'function') return reply();
    return new Response(reply.body, {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { fetch, calls };
}

function client(reply, options = {}) {
  const { fetch, calls } = stubFetch(reply);
  return { client: new Payid19('pub', 'priv', { fetch, ...options }), calls };
}

test('constructor rejects empty keys', () => {
  assert.throws(() => new Payid19('', 'priv'), TypeError);
  assert.throws(() => new Payid19('pub', ''), TypeError);
});

test('createInvoice returns the payment page URL', async () => {
  const url = 'https://payid19.com/invoice/Xy3kP9';
  const { client: c } = client({ body: JSON.stringify({ status: 'success', message: url }) });

  assert.equal(await c.createInvoice({ price_amount: 100 }), url);
});

test('credentials and parameters are sent as form fields', async () => {
  const { client: c, calls } = client({
    body: JSON.stringify({ status: 'success', message: 'https://x' }),
  });

  await c.createInvoice({ price_amount: 100, order_id: 42, template: 'mint' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://payid19.com/api/v1/create_invoice');
  assert.equal(calls[0].init.method, 'POST');

  const sent = new URLSearchParams(calls[0].body);
  assert.equal(sent.get('public_key'), 'pub');
  assert.equal(sent.get('private_key'), 'priv');
  assert.equal(sent.get('price_amount'), '100');
  assert.equal(sent.get('order_id'), '42');
  assert.equal(sent.get('template'), 'mint');
});

test('banned_coins accepts an array and is sent as JSON', async () => {
  const { client: c, calls } = client({
    body: JSON.stringify({ status: 'success', message: 'https://x' }),
  });

  await c.createInvoice({ price_amount: 5, banned_coins: ['BTC', 'USDT-ERC20'] });

  const sent = new URLSearchParams(calls[0].body);
  assert.equal(sent.get('banned_coins'), '["BTC","USDT-ERC20"]');
});

test('undefined and null parameters are omitted, not sent as strings', async () => {
  const { client: c, calls } = client({
    body: JSON.stringify({ status: 'success', message: 'https://x' }),
  });

  await c.createInvoice({ price_amount: 5, email: undefined, title: null });

  const sent = new URLSearchParams(calls[0].body);
  assert.equal(sent.has('email'), false);
  assert.equal(sent.has('title'), false);
});

test('an API error becomes a Payid19Error carrying every message', async () => {
  const { client: c } = client({
    status: 421,
    body: JSON.stringify({ status: 'error', message: ['Wrong public or private key.'] }),
  });

  await assert.rejects(
    () => c.createInvoice({ price_amount: 100 }),
    (err) => {
      assert.ok(err instanceof Payid19Error);
      assert.equal(err.code, 'api_error');
      assert.equal(err.status, 421);
      assert.equal(err.message, 'Wrong public or private key.');
      assert.deepEqual(err.messages, ['Wrong public or private key.']);
      return true;
    },
  );
});

test('a non-2xx status with a non-JSON body reports the status, not bad JSON', async () => {
  const { client: c } = client({ status: 502, body: '<html>Bad Gateway</html>' });

  await assert.rejects(
    () => c.getBalance(),
    (err) => {
      assert.equal(err.code, 'http_error');
      assert.equal(err.status, 502);
      return true;
    },
  );
});

test('an empty body is reported as such', async () => {
  const { client: c } = client({ body: '' });

  await assert.rejects(() => c.getCoins(), (err) => err.code === 'empty_response');
});

test('invalid JSON on a 200 is reported as invalid JSON', async () => {
  const { client: c } = client({ body: 'not json' });

  await assert.rejects(() => c.getCoins(), (err) => err.code === 'invalid_json');
});

test('a transport failure becomes a network_error and keeps the cause', async () => {
  const boom = new Error('socket hang up');
  const { client: c } = client(() => {
    throw boom;
  });

  await assert.rejects(
    () => c.getCoins(),
    (err) => {
      assert.equal(err.code, 'network_error');
      assert.equal(err.cause, boom);
      return true;
    },
  );
});

test('a timeout is reported as a timeout', async () => {
  const timeout = new Error('The operation was aborted due to timeout');
  timeout.name = 'TimeoutError';
  const { client: c } = client(() => {
    throw timeout;
  });

  await assert.rejects(() => c.getCoins(), (err) => err.code === 'timeout');
});

test('verifyCallback accepts the matching key and rejects everything else', () => {
  const { client: c } = client({ body: '{}' });

  assert.equal(c.verifyCallback({ privatekey: 'priv' }), true);
  assert.equal(c.verifyCallback({ privatekey: 'wrong' }), false);
  assert.equal(c.verifyCallback({ privatekey: 'priv-with-suffix' }), false);
  assert.equal(c.verifyCallback({ privatekey: '' }), false);
  assert.equal(c.verifyCallback({}), false);
  assert.equal(c.verifyCallback(null), false);
  assert.equal(c.verifyCallback(undefined), false);
  assert.equal(c.verifyCallback({ privatekey: 123 }), false);
});

test('each documented endpoint posts to its own command URL', async () => {
  const cases = [
    ['getInvoices', 'get_invoices'],
    ['getCoins', 'get_coins'],
    ['getBalance', 'get_balance'],
  ];

  for (const [method, command] of cases) {
    const { client: c, calls } = client({
      body: JSON.stringify({ status: 'success', message: {} }),
    });
    await c[method]();
    assert.equal(calls[0].url, `https://payid19.com/api/v1/${command}`);
  }

  for (const [method, command] of [
    ['getEstimate', 'get_estimate'],
    ['createWithdraw', 'create_withdraw'],
  ]) {
    const { client: c, calls } = client({
      body: JSON.stringify({ status: 'success', message: {} }),
    });
    await c[method]({});
    assert.equal(calls[0].url, `https://payid19.com/api/v1/${command}`);
  }
});

test('request() reaches an endpoint the library does not wrap', async () => {
  const { client: c, calls } = client({
    body: JSON.stringify({ status: 'success', message: { ok: true } }),
  });

  const result = await c.request('some_future_endpoint', { foo: 'bar' });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, 'https://payid19.com/api/v1/some_future_endpoint');
  assert.equal(new URLSearchParams(calls[0].body).get('foo'), 'bar');
});

test('a trailing slash on a custom endpoint does not double up', async () => {
  const { client: c, calls } = client(
    { body: JSON.stringify({ status: 'success', message: 'https://x' }) },
    { apiEndpoint: 'https://example.test/api/v1/' },
  );

  await c.createInvoice({ price_amount: 1 });

  assert.equal(calls[0].url, 'https://example.test/api/v1/create_invoice');
});

test('TEMPLATES lists the four documented designs', () => {
  assert.deepEqual([...TEMPLATES], ['classic', 'slate', 'paper', 'mint']);
});
