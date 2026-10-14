import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAuth, SCOPES } from '../src/auth.ts';
import { CalendarApi } from '../src/calendar-api.ts';

type OAuth = Parameters<GoogleAuth['authorize']>[0];
type Config = Parameters<OAuth['initTokenClient']>[0];
function stub() {
  let config: Config;
  const prompts: string[] = [];
  let revoked = 0;
  const oauth: OAuth & { revoke(): void } = {
    initTokenClient(value) { config = value; return { requestAccessToken(options) { prompts.push(options.prompt); } }; },
    hasGrantedAllScopes(response, ...scopes) { return scopes.every(scope => response.scope?.split(' ').includes(scope)); },
    revoke() { revoked++; },
  };
  return { oauth, prompts, revoked: () => revoked, response: (value: Parameters<Config['callback']>[0]) => config.callback(value), error: (type: string) => config.error_callback({ type }), config: () => config };
}
const valid = { access_token: 'fake-token', expires_in: 3600, scope: SCOPES.join(' ') };

test('initial authorisation requests only Calendar scopes without forcing selection or consent', async () => {
  const sdk = stub();
  const auth = new GoogleAuth('public-client-id', () => {});
  const promise = auth.authorize(sdk.oauth);
  assert.equal(sdk.config().scope, SCOPES.join(' '));
  assert.equal(sdk.config().include_granted_scopes, false);
  assert.deepEqual(sdk.prompts, ['']);
  sdk.response(valid);
  await promise;
  assert.equal(auth.getToken(), 'fake-token');
  auth.clear();
  assert.throws(() => auth.getToken(), /expired/);
  assert.equal(sdk.revoked(), 0);
});

test('repeat authorisation after local sign-out reuses consent without revocation', async () => {
  const sdk = stub();
  const auth = new GoogleAuth('id', () => {});
  let promise = auth.authorize(sdk.oauth);
  sdk.response(valid);
  await promise;
  auth.clear();
  assert.equal(sdk.revoked(), 0);
  promise = auth.authorize(sdk.oauth);
  sdk.response({ ...valid, access_token: 'new-token' });
  await promise;
  assert.deepEqual(sdk.prompts, ['', '']);
  assert.equal(auth.getToken(), 'new-token');
  auth.clear();
});

test('a new auth instance after browser refresh has no token and can reuse Google consent', async () => {
  const sdk = stub();
  const beforeRefresh = new GoogleAuth('id', () => {});
  let promise = beforeRefresh.authorize(sdk.oauth);
  sdk.response(valid);
  await promise;
  beforeRefresh.clear();
  const afterRefresh = new GoogleAuth('id', () => {});
  assert.throws(() => afterRefresh.getToken(), /expired/);
  assert.equal(sdk.prompts.length, 1, 'no automatic/background authorisation');
  promise = afterRefresh.authorize(sdk.oauth);
  sdk.response({ ...valid, access_token: 'after-refresh-token' });
  await promise;
  assert.deepEqual(sdk.prompts, ['', '']);
  assert.equal(sdk.revoked(), 0);
  assert.equal(afterRefresh.getToken(), 'after-refresh-token');
  afterRefresh.clear();
});

test('expired tokens are blocked before API fetch, then click-driven reauthorisation succeeds', async context => {
  const sdk = stub();
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  const auth = new GoogleAuth('id', () => {});
  let promise = auth.authorize(sdk.oauth);
  sdk.response(valid);
  await promise;
  now += 3600001; // Simulate expiry while the browser's timer has not yet run.
  let requests = 0;
  const api = new CalendarApi(() => auth.getToken(), async () => {
    requests++;
    return Response.json({ items: [] });
  });
  await assert.rejects(api.listCalendars(new AbortController().signal), /expired/);
  assert.equal(requests, 0);
  assert.equal(sdk.prompts.length, 1);
  promise = auth.authorize(sdk.oauth);
  sdk.response({ ...valid, access_token: 'renewed-token' });
  await promise;
  assert.equal(auth.getToken(), 'renewed-token');
  assert.deepEqual(sdk.prompts, ['', '']);
  auth.clear();
});

test('partial permissions, denied consent and invalid lifetimes never create a session', async () => {
  for (const response of [{ ...valid, scope: SCOPES[0] }, { error: 'access_denied' }, { ...valid, expires_in: 0 }]) {
    const sdk = stub();
    const auth = new GoogleAuth('id', () => {});
    const promise = auth.authorize(sdk.oauth);
    sdk.response(response);
    await assert.rejects(promise);
    assert.throws(() => auth.getToken());
    const retry = auth.authorize(sdk.oauth);
    sdk.response(valid);
    await retry;
    assert.equal(auth.getToken(), 'fake-token');
    assert.deepEqual(sdk.prompts, ['', '']);
    auth.clear();
  }
});

test('closed and blocked popups reject', async () => {
  for (const type of ['popup_closed', 'popup_failed_to_open']) {
    const sdk = stub();
    const auth = new GoogleAuth('id', () => {});
    const promise = auth.authorize(sdk.oauth);
    sdk.error(type);
    await assert.rejects(promise);
    auth.clear();
  }
});

test('expiry discards token and notifies UI', async () => {
  const sdk = stub();
  let expired = 0;
  const auth = new GoogleAuth('id', () => expired++);
  const promise = auth.authorize(sdk.oauth);
  sdk.response({ ...valid, expires_in: 0.01 });
  await promise;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(expired, 1);
  assert.throws(() => auth.getToken());
  auth.clear();
});

test('logout ignores a late OAuth response', async () => {
  const sdk = stub();
  const auth = new GoogleAuth('id', () => {});
  const promise = auth.authorize(sdk.oauth);
  auth.clear();
  sdk.response(valid);
  await assert.rejects(promise, /cancelled/);
  assert.throws(() => auth.getToken());
});
