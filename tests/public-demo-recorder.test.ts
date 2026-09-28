import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { guardRecordedResponse } from '../scripts/record-public-demo.ts';

test('recorder response guard continues ordinary responses and response-less cancellation notifications', async () => {
  const sent: unknown[] = [];
  const send = async (method: string, params: unknown) => { sent.push({ method, params }); };
  const reject = () => assert.fail('ordinary response must not be labeled a redirect');
  assert.equal(await guardRecordedResponse({ requestId: 'response', responseStatusCode: 200 }, send, reject), 'continued');
  assert.equal(await guardRecordedResponse({ requestId: 'cancellation' }, send, reject), 'continued');
  assert.deepEqual(sent, [
    { method: 'Fetch.continueResponse', params: { requestId: 'response' } },
    { method: 'Fetch.continueRequest', params: { requestId: 'cancellation' } },
  ]);
});

test('recorder tolerates only the exact expired-ID error for the attempted nonredirect continuation', async () => {
  for (const status of [undefined, 200]) {
    const method = status ? 'Fetch.continueResponse' : 'Fetch.continueRequest';
    const event = { requestId: 'cancelled', ...(status ? { responseStatusCode: status } : {}) };
    for (const prefix of ['', 'cdpSession.send: ']) {
      assert.equal(await guardRecordedResponse(event, async attempted => {
        assert.equal(attempted, method); throw new Error(`${prefix}Protocol error (${method}): Invalid InterceptionId.`);
      }, () => assert.fail('not a redirect')), 'already_gone');
    }
  }
});

test('recorder does not suppress unexpected protocol failures or an expired ID from a different command', async () => {
  for (const message of [
    'cdpSession.send: Protocol error (Fetch.continueRequest): Invalid InterceptionId.',
    'cdpSession.send: Protocol error (Fetch.continueResponse): Target closed.',
    'cdpSession.send: Protocol error (Fetch.continueResponse): Invalid InterceptionId. additional failure',
    'cdpSession.send: Protocol error (Fetch.continueResponse): Invalid parameters',
  ]) {
    const error = new Error(message);
    await assert.rejects(guardRecordedResponse({ requestId: 'response', responseStatusCode: 200 }, async () => { throw error; }, () => {}), received => received === error);
  }
});

test('every redirect is refused before CDP failure, including when its interception ID already disappeared', async () => {
  for (const status of [300, 301, 302, 303, 304, 307, 308, 399]) {
    const order: string[] = [];
    const error = new Error('cdpSession.send: Protocol error (Fetch.failRequest): Invalid InterceptionId.');
    await assert.rejects(guardRecordedResponse({ requestId: 'redirect', responseStatusCode: status }, async (method, params) => {
      order.push(method); assert.deepEqual(params, { requestId: 'redirect', errorReason: 'BlockedByClient' }); throw error;
    }, seen => { assert.equal(seen, status); order.push('refused'); }), received => received === error);
    assert.deepEqual(order, ['refused', 'Fetch.failRequest']);
  }
});

test('actual Chromium expired response IDs are tolerated without allowing a redirect to reach its sink', async t => {
  let sinkRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/sink' }); res.end(); return; }
    if (req.url === '/sink') sinkRequests++;
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Invented recorder transport control</title>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }); t.after(() => browser.close());
  const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const refused: number[] = [], failures: unknown[] = [], handled: Promise<unknown>[] = [];
  let completedEvent: { requestId: string; responseStatusCode?: number } | undefined;
  cdp.on('Fetch.requestPaused', event => {
    if (event.responseStatusCode === 200) completedEvent = event;
    const promise = guardRecordedResponse(event, (method, params) => cdp.send(method, params), status => refused.push(status)).catch(error => failures.push(error));
    handled.push(promise);
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] });
  const origin = `http://127.0.0.1:${address.port}`;
  await page.goto(origin, { waitUntil: 'load' }); await Promise.all(handled);
  assert.ok(completedEvent); const retired = completedEvent;
  // Reusing the just-completed real Chromium interception ID reproduces the
  // expired-ID command failure without starting any app/model/candidate work.
  await assert.rejects(cdp.send('Fetch.continueResponse', { requestId: retired.requestId }), /Protocol error \(Fetch\.continueResponse\): Invalid InterceptionId\./);
  assert.equal(await guardRecordedResponse(retired, (method, params) => cdp.send(method, params), () => assert.fail('not a redirect')), 'already_gone');
  await assert.rejects(page.goto(origin + '/redirect'), /ERR_BLOCKED_BY_CLIENT/);
  await Promise.all(handled);
  assert.deepEqual(refused, [302]); assert.equal(sinkRequests, 0); assert.deepEqual(failures, []);
});
