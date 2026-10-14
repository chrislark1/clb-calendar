import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleAuth, SCOPES } from '../src/auth.ts';

type OAuth = Parameters<GoogleAuth['authorize']>[0];
type Config = Parameters<OAuth['initTokenClient']>[0];
function stub() {
  let config: Config;
  const oauth: OAuth = {
    initTokenClient(value) { config = value; return { requestAccessToken(options) { assert.equal(options.prompt, 'select_account'); } }; },
    hasGrantedAllScopes(response, ...scopes) { return scopes.every(scope => response.scope?.split(' ').includes(scope)); },
  };
  return { oauth, response: (value: Parameters<Config['callback']>[0]) => config.callback(value), error: (type: string) => config.error_callback({ type }), config: () => config };
}
const valid = { access_token: 'fake-token', expires_in: 3600, scope: SCOPES.join(' ') };

test('authorisation requests only Calendar scopes, memory token clears on logout', async () => {
  const sdk = stub();
  const auth = new GoogleAuth('public-client-id', () => {});
  const promise = auth.authorize(sdk.oauth);
  assert.equal(sdk.config().scope, SCOPES.join(' '));
  assert.equal(sdk.config().include_granted_scopes, false);
  sdk.response(valid);
  await promise;
  assert.equal(auth.getToken(), 'fake-token');
  auth.clear();
  assert.throws(() => auth.getToken(), /expired/);
});

test('partial permissions, denied consent and invalid lifetimes never create a session', async () => {
  for (const response of [{ ...valid, scope: SCOPES[0] }, { error: 'access_denied' }, { ...valid, expires_in: 0 }]) {
    const sdk = stub();
    const auth = new GoogleAuth('id', () => {});
    const promise = auth.authorize(sdk.oauth);
    sdk.response(response);
    await assert.rejects(promise);
    assert.throws(() => auth.getToken());
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
