// Dev-only fixture: Vite's production entry does not import this file.
import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { SCOPES } from '../src/auth.ts';
import { DAY_COLUMNS, eventKey } from '../src/planner-layout.ts';
import '../src/styles.css';

let status = 200;
let calls = 0;
let lifetime = 3600;
let blocked = false;
let partial = false;
let plannerFixture = false;
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
  const base = [
    { id: 'a', summary: '<img src=x onerror=alert(1)>', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } },
    { id: 'b', summary: 'Recurring instance', recurringEventId: 'series', start: { dateTime: '2026-10-14T11:00:00+01:00' }, end: { dateTime: '2026-10-14T12:00:00+01:00' } },
  ];
  return Response.json({ items: plannerFixture ? [...base,
    { id: 'month-span', summary: 'Across two months', description: 'Read-only details\nSecond line', start: { date: '2026-09-30' }, end: { date: '2026-10-03' } },
    { id: 'year-span', summary: 'Across the year', start: { date: '2026-12-30' }, end: { date: '2027-01-03' } },
    { id: 'overlap', summary: 'Overlapping dates', start: { date: '2026-10-14' }, end: { date: '2026-10-17' } },
  ] : base });
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
  const value = [...document.querySelectorAll<HTMLButtonElement>('#root button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
  if (!value || value.disabled) throw new Error(`Button unavailable: ${text}`);
  value.click();
}
function check(condition: boolean, description: string) {
  if (!condition) throw new Error(description);
  results.textContent += `\nPASS ${description}`;
}
async function login() {
  button('Sign in with Google');
  await waitFor(() => document.querySelectorAll('#root .event-bar').length === 2 && !document.querySelector<HTMLButtonElement>('#root [data-action=refresh]')?.disabled);
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
    (document.querySelector('#root .calendar-controls') as HTMLDetailsElement).open = true;
    check(content().includes('Calendars (1)'), 'primary calendar selected automatically');
    check(document.querySelectorAll('#root img, #root script').length === 0 && content().includes('<img'), 'event text renders safely without HTML execution');
    document.querySelector<HTMLButtonElement>('#root .event-bar')!.click();
    await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('#root dialog')?.open));
    check(content().includes('All-day'), 'all-day details preserve date-only times');
    button('Close');
    [...document.querySelectorAll<HTMLButtonElement>('#root .event-bar')].find(b => b.textContent === 'Recurring instance')!.click();
    await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('#root dialog')?.open));
    check(content().includes('Timed') && content().includes('2026-10-14 11:00:00+01:00'), 'timed details retain original timestamps');
    button('Close');
    check(document.querySelectorAll<HTMLInputElement>('#root input[type=checkbox]')[1].disabled, 'freebusy-only calendar cannot be selected');
    const checkbox = document.querySelector<HTMLInputElement>('#root input[type=checkbox]')!;
    checkbox.click();
    await waitFor(() => content().includes('Calendars (0)') && content().includes('Select a calendar'));
    check(!content().includes('Recurring instance'), 'deselect clears events');
    const cachedCalls = calls;
    checkbox.click();
    await waitFor(() => document.querySelectorAll('#root .event-bar').length === 2 && !document.querySelector<HTMLButtonElement>('#root [data-action=refresh]')?.disabled);
    check(calls === cachedCalls, 'calendar visibility reuses in-memory data');
    const before = calls;
    button('Refresh');
    await waitFor(() => calls >= before + 2 && document.querySelectorAll('#root .event-bar').length === 2);
    check(calls >= before + 2, 'refresh rediscovers calendars and retrieves events');
    status = 403;
    button('Refresh');
    await waitFor(() => content().includes('Google denied access'));
    check(!content().includes('Recurring instance'), '403 clears stale events and offers error with session retained');
    status = 200;
    button('Refresh');
    await waitFor(() => document.querySelectorAll('#root .event-bar').length === 2);
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
    // Give a background browser enough time to observe the authorised UI before expiry.
    lifetime = 2;
    await login();
    await waitFor(() => content().includes('Sign in with Google'));
    check(!content().includes('Fixture Calendar'), 'token expiry removes private UI');
    lifetime = 3600;
    await login();
    check(content().includes('Fixture Calendar'), 'reauthorisation after expiry restores the app');
    check(prompts.every(prompt => prompt === ''), 'initial and repeat sign-in leave consent and account prompts to Google');
    check(revocations === 0, 'refresh, expiry and failed authorisation do not revoke consent');
    plannerFixture = true;
    button('Refresh');
    await waitFor(() => document.querySelectorAll('#root .event-bar').length === 7);
    check(document.querySelectorAll('#root .month-row').length === 13, 'thirteen rolling months render');
    check([...document.querySelectorAll('#root .month-grid')].every(grid => grid.querySelectorAll('.day-column').length === DAY_COLUMNS), 'all months retain 42 aligned weekday columns');
    const spanKey = eventKey({ calendarId: 'primary-test', id: 'month-span' } as Parameters<typeof eventKey>[0]);
    const segments = [...document.querySelectorAll<HTMLButtonElement>('#root .event-bar')].filter(bar => bar.dataset.event === spanKey);
    const dayWidth = document.querySelector('#root .day-column')!.getBoundingClientRect().width;
    check(segments.length === 2 && Math.abs(segments[0].getBoundingClientRect().width - (dayWidth - 2)) < .1 && Math.abs(segments[1].getBoundingClientRect().width - (dayWidth * 2 - 2)) < .1, 'month-spanning bars use correct exclusive date widths');
    for (const segment of segments) {
      segment.click();
      await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('#root dialog')?.open));
      check(document.querySelector('#event-title')?.textContent === 'Across two months' && content().includes('Read-only details'), 'each month segment opens the same original event');
      button('Close');
    }
    const october = document.querySelector<HTMLElement>('#root [data-month="2026-10-01"]')!;
    const overlapping = [...october.querySelectorAll<HTMLElement>('.event-bar')].filter(bar => bar.dataset.start === '2026-10-14');
    check(new Set(overlapping.map(bar => bar.dataset.track)).size === 3, 'overlapping dates occupy separate compact tracks');
    check([...document.querySelectorAll<HTMLElement>('#root .event-bar')].filter(bar => bar.textContent === 'Across the year').length === 2, 'year-spanning events split at month boundaries');
    const viewport = document.querySelector<HTMLElement>('#root .planner-viewport')!;
    button('Next month');
    await waitFor(() => document.querySelectorAll('#root .month-row').length === 14 && !content().includes('Retrieving…'));
    check(document.querySelectorAll('#root .month-row').length === 14 && window.scrollY > 0, 'future navigation expands and scrolls the continuous horizon');
    const beforePast = calls;
    button('Previous month');
    await waitFor(() => document.querySelectorAll('#root .month-row').length === 15 && !content().includes('Retrieving…'));
    check(calls === beforePast + 1, 'past expansion retrieves only missing calendar data');
    button('Today');
    await waitFor(() => window.scrollY > 0);
    const marker = document.querySelector<HTMLElement>('#root .day-column.today')!;
    const rect = marker.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    const topHeight = document.querySelector('#root .planner-top')!.getBoundingClientRect().height;
    check(rect.left >= view.left && rect.left < view.right && rect.top >= topHeight && rect.top < window.innerHeight, 'Today scrolls current date into view');
    check(viewport.scrollHeight === viewport.clientHeight, 'planner uses page scrolling without a nested vertical scrollbar');
    check(!content().includes('Retrieval:') && !document.querySelector('#root .category-legend'), 'default interface removes diagnostics and permanent legend');
    results.textContent += '\nAll browser checks passed (M1 + M2).';
  } catch (error) { results.textContent += `\nFAIL ${String(error)}`; }
};
