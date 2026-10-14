// Dev-only fixture: Vite's production entry does not import this file.
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { SCOPES } from '../src/auth.ts';
import '../src/styles.css';

let status = 200;
let calls = 0;
let lifetime = 3600;
let blocked = false;
let partial = false;
const prompts: string[] = [];
let revocations = 0;
const fixtureOAuth = {
  initTokenClient(config: Parameters<NonNullable<Window['google']>['accounts']['oauth2']['initTokenClient']>[0]) {
    return { requestAccessToken(options: { prompt: string }) {
      prompts.push(options.prompt);
      if (blocked) config.error_callback({ type: 'popup_closed' });
      else config.callback({ access_token: 'disposable-token', expires_in: lifetime, scope: partial ? SCOPES[0] : SCOPES.join(' ') });
    } };
  },
  hasGrantedAllScopes(response: { scope?: string }, ...scopes: string[]) { return scopes.every(scope => response.scope?.split(' ').includes(scope)); },
  revoke() { revocations++; },
};
window.google = { accounts: { oauth2: fixtureOAuth } };
window.fetch = async (input, init) => {
  calls++;
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (status !== 200) return new Response('{}', { status });
  const url = new URL(String(input));
  if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [
    { id: 'primary-test', summary: 'Fixture Calendar', primary: true, accessRole: 'owner', timeZone: 'Europe/London', backgroundColor: '#123456' },
    { id: 'busy-test', summary: 'Busy only', accessRole: 'freeBusyReader', timeZone: 'Europe/London' },
  ] });
  return Response.json({ items: [
    { id: 'a', summary: '<img src=x onerror=alert(1)>', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } },
    { id: 'b', summary: 'Recurring instance', recurringEventId: 'series', start: { dateTime: '2026-10-14T11:00:00+01:00' }, end: { dateTime: '2026-10-14T12:00:00+01:00' } },
  ] });
};

// Any attempt by application code to persist tokens/data fails this fixture.
Storage.prototype.setItem = () => { throw new Error('Persistent storage is forbidden in this test'); };
let root = createRoot(document.getElementById('root')!);
root.render(<App clientId="disposable.apps.googleusercontent.com" />);
const results = document.getElementById('results')!;
const content = () => document.getElementById('root')!.textContent || '';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(30); }
  throw new Error(`Timed out. UI: ${content()}`);
}
function button(text: string) {
  const value = [...document.querySelectorAll<HTMLButtonElement>('#root button')].find(b => b.textContent === text);
  if (!value || value.disabled) throw new Error(`Button unavailable: ${text}`);
  value.click();
}
function check(condition: boolean, description: string) {
  if (!condition) throw new Error(description);
  results.textContent += `\nPASS ${description}`;
}
async function login() {
  button('Sign in with Google');
  await waitFor(() => content().includes('2 events retrieved'));
}
document.getElementById('run')!.onclick = async () => {
  (document.getElementById('run') as HTMLButtonElement).disabled = true;
  results.textContent = 'Running';
  try {
    await waitFor(() => content().includes('Sign in with Google'));
    check(content() === 'CLB CalendarSign in with Google', 'signed-out page contains only title and sign-in');
    check(calls === 0, 'no Calendar API calls before authorisation');
    blocked = true;
    button('Sign in with Google');
    await waitFor(() => content().includes('closed'));
    check(!content().includes('Fixture Calendar'), 'failed popup exposes no calendar data');
    blocked = false;
    partial = true;
    button('Sign in with Google');
    await waitFor(() => content().includes('Both read-only'));
    check(calls === 0, 'partial consent does not access Calendar API');
    partial = false;
    await login();
    check(content().includes('1 selected calendars'), 'primary calendar selected automatically');
    check(document.querySelectorAll('#root img, #root script').length === 0 && content().includes('<img'), 'event text renders safely without HTML execution');
    check(content().includes('All-day') && content().includes('Timed'), 'all-day and timed event list');
    check(document.querySelectorAll<HTMLInputElement>('#root input[type=checkbox]')[1].disabled, 'freebusy-only calendar cannot be selected');
    const checkbox = document.querySelector<HTMLInputElement>('#root input[type=checkbox]')!;
    checkbox.click();
    await waitFor(() => content().includes('0 selected calendars') && content().includes('Select a calendar'));
    check(!content().includes('Recurring instance'), 'deselect clears events');
    checkbox.click();
    await waitFor(() => content().includes('2 events retrieved'));
    const before = calls;
    button('Refresh');
    await waitFor(() => calls >= before + 2 && content().includes('2 events retrieved'));
    check(calls >= before + 2, 'refresh rediscovers calendars and retrieves events');
    status = 403;
    button('Refresh');
    await waitFor(() => content().includes('Google denied access'));
    check(!content().includes('Recurring instance'), '403 clears stale events and offers error with session retained');
    status = 200;
    button('Refresh');
    await waitFor(() => content().includes('2 events retrieved'));
    button('Sign out');
    await waitFor(() => content().includes('Sign in with Google'));
    check(content() === 'CLB CalendarSign in with Google', 'logout removes all private UI');
    check(revocations === 0, 'ordinary sign-out preserves Google consent');
    await login();
    // Recreate all app state as a document refresh would; Google's saved grant is external.
    const beforeRemount = calls;
    const beforeAuthorisation = prompts.length;
    root.unmount();
    root = createRoot(document.getElementById('root')!);
    root.render(<App clientId="disposable.apps.googleusercontent.com" />);
    await waitFor(() => content() === 'CLB CalendarSign in with Google');
    check(!content().includes('Fixture Calendar'), 'refresh-equivalent remount hides private information');
    check(calls === beforeRemount && prompts.length === beforeAuthorisation, 'remount does not fetch data or request a background token');
    await login();
    status = 401;
    button('Refresh');
    await waitFor(() => content().includes('Sign in with Google'));
    check(!content().includes('Fixture Calendar') && content().includes('expired'), '401 clears private session');
    status = 200;
    lifetime = 0.25;
    await login();
    await waitFor(() => content().includes('Sign in with Google'));
    check(!content().includes('Fixture Calendar'), 'token expiry removes private UI');
    lifetime = 3600;
    await login();
    check(content().includes('Fixture Calendar'), 'reauthorisation after expiry restores the app');
    check(prompts.every(prompt => prompt === ''), 'initial and repeat sign-in leave consent and account prompts to Google');
    check(revocations === 0, 'refresh, expiry and failed authorisation do not revoke consent');
    results.textContent += '\nAll 20 browser checks passed.';
  } catch (error) { results.textContent += `\nFAIL ${String(error)}`; }
};
