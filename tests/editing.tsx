import { createRoot } from 'react-dom/client';
import App from '../src/App.tsx';
import { SCOPES } from '../src/auth.ts';
import { CATEGORY_PROPERTY } from '../src/categories.ts';
import '../src/styles.css';

interface DemoEvent {
  id: string; etag: string; summary: string; description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
  location?: string; attendees?: { email: string }[];
}
const initial: DemoEvent[] = [
  { id: 'ordinary', etag: '"1"', summary: 'External ordinary event', description: '<b>Literal note</b>',
    start: { dateTime: '2026-10-14T09:42:17.123+01:00', timeZone: 'Europe/London' },
    end: { dateTime: '2026-10-14T12:36:04.456+01:00', timeZone: 'Europe/London' },
    extendedProperties: { private: { foreignPrivate: 'keep' }, shared: { foreignShared: 'keep' } },
    location: 'Existing location', attendees: [{ email: 'fake@example.test' }] },
  { id: 'seriesinstance', etag: '"1"', summary: 'Series instance', recurringEventId: 'series', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } },
];
const store = new Map<string, Map<string, DemoEvent>>([
  ['owner', new Map(initial.map(event => [event.id, event]))], ['writer', new Map()],
  ['reader', new Map([['readonly', { ...initial[1], id: 'readonly', summary: 'Read-only event', recurringEventId: undefined }]])],
]);
const requests: { method: string; calendar: string; body?: Record<string, unknown> }[] = [];
let version = 1;
let nextWriteStatus = 200;
let pauseWrite = false;
let releaseWrite: (() => void) | undefined;
let readOnlyAccount = false;
window.google = { accounts: { oauth2: {
  initTokenClient(config) { return { requestAccessToken() { config.callback({ access_token: 'fake', expires_in: 3600, scope: SCOPES.join(' ') }); } }; },
  hasGrantedAllScopes(response, ...scopes) { return scopes.every(scope => response.scope?.split(' ').includes(scope)); },
} } };
window.fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  init?.signal?.throwIfAborted();
  if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [
    { id: 'owner', summary: 'Owner calendar', primary: true, accessRole: readOnlyAccount ? 'reader' : 'owner', timeZone: 'Europe/London', backgroundColor: '#4285f4' },
    { id: 'writer', summary: 'Writable shared calendar', accessRole: readOnlyAccount ? 'reader' : 'writer', timeZone: 'Europe/London' },
    { id: 'reader', summary: 'Read-only calendar', accessRole: 'reader', timeZone: 'Europe/London' },
  ] });
  const match = url.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/)!;
  const calendar = decodeURIComponent(match[1]);
  const id = match[2] && decodeURIComponent(match[2]);
  const data = store.get(calendar)!;
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ method, calendar, body });
  if (method !== 'GET') {
    if (pauseWrite) { pauseWrite = false; await new Promise<void>(resolve => { releaseWrite = resolve; }); }
    init?.signal?.throwIfAborted();
    if (nextWriteStatus !== 200) { const status = nextWriteStatus; nextWriteStatus = 200; return Response.json({}, { status }); }
  }
  if (method === 'GET') return id ? Response.json(data.get(id) ?? {}, { status: data.has(id) ? 200 : 404 }) : Response.json({ items: [...data.values()] });
  if (method === 'POST') {
    if (data.has(body.id)) return Response.json({}, { status: 409 });
    const event = { ...body, etag: `"${++version}"` } as DemoEvent;
    data.set(event.id, event); return Response.json(event);
  }
  const old = data.get(id!)!;
  if (!old) return Response.json({}, { status: 404 });
  if ((init?.headers as Record<string, string>)['If-Match'] !== old.etag) return Response.json({}, { status: 412 });
  if (method === 'DELETE') { data.delete(id!); return new Response(null, { status: 204 }); }
  const cleanTime = (time: Record<string, unknown>) => Object.fromEntries(Object.entries(time).filter(([, value]) => value !== null));
  const event = { ...old, ...body, etag: `"${++version}"`, start: body.start ? cleanTime(body.start) : old.start, end: body.end ? cleanTime(body.end) : old.end } as DemoEvent;
  data.set(id!, event); return Response.json(event);
};
Storage.prototype.setItem = () => { throw new Error('Persistent storage is forbidden'); };
let root = createRoot(document.getElementById('root')!);
const render = () => root.render(<App clientId="fake.apps.googleusercontent.com" />);
render();
const results = document.getElementById('results')!;
const content = () => document.getElementById('root')!.textContent ?? '';
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 150; i++) { if (check()) return; await pause(); }
  throw new Error(`Timed out: ${content()}`);
}
function check(condition: boolean, label: string) { if (!condition) throw new Error(label); results.textContent += `\nPASS ${label}`; }
function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#root button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text);
  if (!button || button.disabled) throw new Error(`Button unavailable: ${text}`);
  button.click();
}
async function field(label: string, value: string) {
  const wrapper = [...document.querySelectorAll<HTMLLabelElement>('.event-editor label')].find(el => el.firstChild?.textContent === label)!;
  const input = wrapper.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')!;
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  await pause();
}
async function openEvent(title: string) {
  [...document.querySelectorAll<HTMLButtonElement>('#root .event-bar')].find(b => b.textContent === title)!.click();
  await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('.event-details:not(.event-editor)')?.open));
}
async function edit(title: string) { await openEvent(title); click('Edit'); await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('.event-editor')?.open)); }
async function loaded() { await waitFor(() => Boolean(document.querySelector('[data-action=refresh]')) && !(document.querySelector('[data-action=refresh]') as HTMLButtonElement).disabled); }
document.getElementById('run')!.onclick = async () => {
  (document.getElementById('run') as HTMLButtonElement).disabled = true;
  results.textContent = 'Running';
  try {
    await pause(); click('Sign in with Google'); await loaded();
    const dateButton = document.querySelector<HTMLButtonElement>('[data-date="2026-10-20"] .date-hit')!;
    dateButton.focus(); dateButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    check(document.activeElement?.getAttribute('aria-label') === 'Create event on 2026-10-21', 'keyboard arrows move date focus without opening an editor');
    dateButton.click(); await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('.event-editor')?.open));
    const pickedDates = document.querySelectorAll<HTMLInputElement>('.event-editor input[type=date]');
    check(pickedDates[0].value === '2026-10-20' && pickedDates[1].value === '2026-10-20' && (document.querySelector('.event-editor select') as HTMLSelectElement).value === 'owner', 'date activation prepopulates both inclusive dates and the preferred writable calendar');
    check((document.querySelectorAll('.event-editor select')[2] as HTMLSelectElement).value === 'All day', 'date creation defaults to all-day');
    click('Cancel'); await waitFor(() => !document.querySelector('.event-editor'));
    click('New event'); await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('.event-editor')?.open));
    check(document.querySelectorAll('.event-editor select')[0].querySelectorAll('option').length === 2, 'creation offers only writable calendars');
    check((document.querySelectorAll('.event-editor select')[2] as HTMLSelectElement).value === 'All day', 'new events default to all-day');
    await field('Title', 'Created event'); await field('Calendar', 'writer'); await field('Category', 'Social');
    await field('Start date', '2026-10-14'); await field('End date', '2026-10-15'); await field('Note / description', 'Literal note <img src=x onerror=alert(1)>');
    pauseWrite = true;
    const form = document.querySelector<HTMLFormElement>('.event-editor form')!;
    form.requestSubmit(); form.requestSubmit();
    await waitFor(() => Boolean(releaseWrite));
    check(requests.filter(request => request.method === 'POST').length === 1, 'double Save submits only one create request');
    releaseWrite!(); await waitFor(() => !document.querySelector('.event-editor')); await loaded();
    const created = [...store.get('writer')!.values()][0];
    check(created.end.date === '2026-10-16' && created.start.date === '2026-10-14', 'inclusive all-day dates persist as exclusive Google dates');
    check(created.extendedProperties?.shared?.[CATEGORY_PROPERTY] === 'Social', 'explicit category persists on Google event');
    check([...document.querySelectorAll('.event-bar')].some(el => el.textContent === 'Created event'), 'create refreshes and selects its calendar');
    click('Refresh'); await loaded();
    await openEvent('Created event');
    check(!document.querySelector('.event-editor'), 'event bars open details without triggering date creation');
    check(content().includes('Social') && content().includes('Literal note <img') && !document.querySelector('#root img'), 'refreshed metadata and descriptions render safely'); click('Close');
    await waitFor(() => !document.querySelector<HTMLDialogElement>('.event-details')?.open);
    await edit('External ordinary event');
    check((document.querySelector('.event-editor select') as HTMLSelectElement).disabled, 'editing keeps the original calendar');
    await field('Title', 'External renamed'); await field('Category', 'Garden'); click('Save event');
    await waitFor(() => !document.querySelector('.event-editor')); await loaded();
    const updated = store.get('owner')!.get('ordinary')!;
    check(updated.start.dateTime === initial[0].start.dateTime && updated.end.dateTime === initial[0].end.dateTime, 'text-only editing preserves exact custom times and fractions');
    check(updated.extendedProperties?.private?.foreignPrivate === 'keep' && updated.extendedProperties?.shared?.foreignShared === 'keep' && updated.attendees?.length === 1 && updated.location === 'Existing location', 'unrelated metadata, attendees and location survive editing');
    await openEvent('Series instance');
    check(content().includes('Recurring events must be edited') && ![...document.querySelectorAll('.event-details button')].some(b => ['Edit', 'Delete'].includes(b.textContent ?? '')), 'recurring instances remain clearly read-only'); click('Close');
    await waitFor(() => !document.querySelector<HTMLDialogElement>('.event-details')?.open);
    (document.querySelector('.calendar-controls') as HTMLDetailsElement).open = true;
    document.querySelectorAll<HTMLInputElement>('.calendar-controls input')[2].click(); await loaded(); await waitFor(() => [...document.querySelectorAll('.event-bar')].some(b => b.textContent === 'Read-only event'));
    await openEvent('Read-only event'); check(![...document.querySelectorAll('.event-details button')].some(b => ['Edit', 'Delete'].includes(b.textContent ?? '')), 'read-only calendar events offer details without edit actions'); click('Close');
    await waitFor(() => !document.querySelector<HTMLDialogElement>('.event-details')?.open);
    document.querySelector<HTMLButtonElement>('[data-date="2026-10-14"] .date-hit')!.click();
    await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('.event-editor')?.open));
    check((document.querySelector('.event-editor select') as HTMLSelectElement).value === 'owner', 'dates containing read-only events can create on another writable calendar');
    click('Cancel'); await waitFor(() => !document.querySelector('.event-editor'));
    await edit('Created event'); click('Delete event');
    await waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Keep event'));
    check(requests.filter(r => r.method === 'DELETE').length === 0, 'deletion waits for explicit confirmation'); click('Keep event');
    await waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Delete event'));
    check(store.get('writer')!.has(created.id), 'cancelled deletion keeps the event'); click('Delete event');
    await waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Confirm delete')); click('Confirm delete');
    await waitFor(() => !document.querySelector('.event-editor')); await loaded();
    check(!store.get('writer')!.has(created.id) && ![...document.querySelectorAll('.event-bar')].some(b => b.textContent === 'Created event'), 'confirmed deletion persists and removes refreshed bars');
    click('New event'); await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('.event-editor')?.open));
    await field('Title', 'Retry event'); nextWriteStatus = 403; click('Save event');
    await waitFor(() => content().includes('Google denied access'));
    check((document.querySelector('.event-editor input') as HTMLInputElement).value === 'Retry event', 'API failure retains the draft'); click('Save event');
    await waitFor(() => !document.querySelector('.event-editor')); await loaded();
    check([...document.querySelectorAll('.event-bar')].some(b => b.textContent === 'Retry event'), 'retry succeeds after permission error');
    await openEvent('Retry event');
    check([...document.querySelectorAll('.event-details button')].some(b => b.textContent === 'Delete'), 'writable ordinary events offer direct Delete in details');
    click('Delete'); await waitFor(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Confirm delete'));
    check(!document.querySelector('.event-editor') && Boolean(document.querySelector('.event-details:not(.event-editor) .delete-confirmation')), 'direct Delete confirms inside the original details panel without opening the editor');
    click('Keep event'); await waitFor(() => !document.querySelector('.delete-confirmation'));
    check(Boolean(document.querySelector<HTMLDialogElement>('.event-details:not(.event-editor)')?.open), 'Keep event returns to the same details panel');
    click('Delete'); await waitFor(() => Boolean(document.querySelector('.delete-confirmation')));
    nextWriteStatus = 403; click('Confirm delete');
    await waitFor(() => content().includes('Google denied access'));
    check(Boolean(document.querySelector<HTMLDialogElement>('.event-details:not(.event-editor)')?.open) && content().includes('Retry event'), 'failed direct deletion preserves event details and displays the error');
    click('Confirm delete'); await waitFor(() => !document.querySelector<HTMLDialogElement>('.event-details:not(.event-editor)')?.open); await loaded();
    check(!store.get('owner')!.has([...store.get('owner')!.values()].find(e => e.summary === 'Retry event')?.id ?? ''), 'direct deletion retries through existing confirmed deletion flow');
    await edit('External renamed'); await field('Timing mode', 'PM');
    const timeInputs = document.querySelectorAll<HTMLInputElement>('.event-editor input[type=time]');
    check(timeInputs[0].value === '13:00' && timeInputs[1].value === '18:00', 'PM shortcut sets its documented hours');
    await field('Timing mode', 'Custom'); await field('Start time', '22:15:30.123'); await field('End date', '2026-10-15'); await field('End time', '01:05:45.456');
    click('Save event'); await waitFor(() => !document.querySelector('.event-editor')); await loaded();
    const overnight = store.get('owner')!.get('ordinary')!;
    check(overnight.start.dateTime === '2026-10-14T21:15:30.123Z' && overnight.end.dateTime === '2026-10-15T00:05:45.456Z', 'Custom overnight times persist with the correct zone and precision');
    await edit('External renamed'); await field('Start date', '2026-03-29'); await field('End date', '2026-03-29'); await field('Start time', '01:30'); await field('End time', '03:30');
    const beforeInvalid = requests.filter(r => r.method === 'PATCH').length;
    click('Save event'); await waitFor(() => content().includes('does not exist'));
    check(requests.filter(r => r.method === 'PATCH').length === beforeInvalid, 'DST gap is rejected before an API mutation'); click('Cancel');
    await waitFor(() => !document.querySelector('.event-editor'));
    root.unmount(); root = createRoot(document.getElementById('root')!); render();
    await waitFor(() => content().includes('Sign in with Google')); click('Sign in with Google'); await loaded();
    check([...document.querySelectorAll('.event-bar')].some(b => b.textContent === 'External renamed'), 'fresh app session reads persisted edits from Google');
    click('Sign out'); await waitFor(() => content() === 'CLB CalendarSign in with Google');
    check(!document.querySelector('.event-editor') && !content().includes('External renamed'), 'logout clears editor and private information');
    click('Sign in with Google'); await loaded(); click('New event'); await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('.event-editor')?.open));
    await field('Title', 'Expired request'); nextWriteStatus = 401; click('Save event');
    await waitFor(() => content().includes('Sign in with Google'));
    check(!document.querySelector('.event-editor') && !content().includes('External renamed'), 'write-time 401 clears the session and editor');
    readOnlyAccount = true; click('Sign in with Google'); await loaded();
    check([...document.querySelectorAll<HTMLButtonElement>('#root button')].find(b => b.textContent === 'New event')!.disabled, 'read-only accounts cannot create events');
    check([...document.querySelectorAll<HTMLButtonElement>('.date-hit')].every(button => button.disabled) && content().includes('No writable calendars available'), 'date creation is disabled with an explanation when no calendars are writable');
    results.textContent += '\nAll editing browser checks passed.';
  } catch (error) { results.textContent += `\nFAIL ${String(error)}`; }
};
document.getElementById('preview')!.onclick = async () => {
  readOnlyAccount = false;
  root.unmount(); root = createRoot(document.getElementById('root')!); render();
  await waitFor(() => content().includes('Sign in with Google')); await pause(); click('Sign in with Google'); await loaded();
  click('New event'); await waitFor(() => Boolean(document.querySelector<HTMLDialogElement>('.event-editor')?.open));
  await field('Title', 'Sample overnight event'); await field('Category', 'Holiday'); await field('Timing mode', 'Custom');
  await field('Start date', '2026-10-24'); await field('End date', '2026-10-25'); await field('Start time', '23:30'); await field('End time', '03:30');
  await field('Note / description', 'Sample data only. No real Google Calendar requests are made.');
};
