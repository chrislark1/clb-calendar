import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarApi, CalendarApiError, canReadEvents, normalizeEvent } from '../src/calendar-api.ts';
import { defaultRange, rangeBounds, sortEvents } from '../src/dates.ts';
import type { Calendar } from '../src/types.ts';

const calendar: Calendar = { id: 'shared/name@example.test', name: 'Shared', timeZone: 'Europe/London', primary: false, accessRole: 'reader' };
const range = { start: '2026-08-14', end: '2027-08-14' };
const signal = () => new AbortController().signal;
function fakeFetch(pages: unknown[], inspect: (url: URL, init: RequestInit) => void = () => {}) {
  return (async (input, init) => {
    inspect(new URL(String(input)), init!);
    assert.ok(pages.length, 'unexpected extra request');
    return new Response(JSON.stringify(pages.shift()), { status: 200 });
  }) as typeof fetch;
}

test('default fetch preserves the browser receiver for calendar and event pagination', async context => {
  const responses = [
    { items: [], nextPageToken: 'calendars-next' },
    { items: [{ id: calendar.id, summary: calendar.name, accessRole: calendar.accessRole, timeZone: calendar.timeZone }] },
    { items: [], nextPageToken: 'events-next' },
    { items: [{ id: 'event', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } }] },
  ];
  const urls: URL[] = [];
  context.mock.method(globalThis, 'fetch', async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    // Browser-native fetch rejects an unrelated receiver; arrow stubs hide this bug.
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    urls.push(new URL(String(input)));
    assert.deepEqual(init?.headers, { Authorization: 'Bearer test-token' });
    assert.ok(responses.length, 'unexpected extra request');
    return Response.json(responses.shift());
  });
  const api = new CalendarApi(() => 'test-token');
  const calendars = await api.listCalendars(signal());
  const events = await api.listEvents(calendars, range, signal());
  assert.equal(events.length, 1);
  assert.equal(events[0].calendarId, calendar.id);
  assert.deepEqual(urls.map(url => url.searchParams.get('pageToken')), [null, 'calendars-next', null, 'events-next']);
});

test('default window clamps month ends and input range rejects invalid/reversed dates', () => {
  assert.deepEqual(defaultRange(new Date(2026, 3, 30)), { start: '2026-02-28', end: '2027-02-28' });
  assert.deepEqual(defaultRange(new Date(2026, 9, 14)), range);
  assert.throws(() => rangeBounds({ start: '2026-02-30', end: range.end }));
  assert.throws(() => rangeBounds({ start: range.end, end: range.start }));
  assert.throws(() => rangeBounds({ start: range.start, end: range.start }));
  const bounds = rangeBounds(range);
  assert.equal(new Date(bounds.timeMin).getDate(), 14);
  assert.equal(new Date(bounds.timeMin).getHours(), 0);
});

test('calendar discovery follows empty pages and retains metadata, including hidden/freebusy calendars', async () => {
  let request = 0;
  const api = new CalendarApi(() => 'test-token', fakeFetch([
    { items: [], nextPageToken: 'next' },
    { items: [{ id: 'c', summary: 'Original', summaryOverride: 'Alias', description: 'Description',
      backgroundColor: '#123456', foregroundColor: '#ffffff', colorId: '4', timeZone: 'Europe/London', accessRole: 'freeBusyReader', primary: true }] },
  ], (url, init) => {
    assert.equal(url.searchParams.get('showHidden'), 'true');
    assert.equal(url.searchParams.get('pageToken'), request++ ? 'next' : null);
    assert.deepEqual(init.headers, { Authorization: 'Bearer test-token' });
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'omit');
  }));
  const rows = await api.listCalendars(signal());
  assert.deepEqual(rows[0], { id: 'c', name: 'Alias', description: 'Description', color: '#123456', foregroundColor: '#ffffff', colorId: '4', timeZone: 'Europe/London', accessRole: 'freeBusyReader', primary: true });
  assert.equal(canReadEvents(rows[0]), false);
});

test('events paginate, expand recurrence, retain IDs/ownership, sort and omit cancellations', async () => {
  let request = 0;
  const pages = [
    { items: [{ id: 'timed', summary: '<script>private text</script>', start: { dateTime: '2026-10-25T10:00:00+00:00', timeZone: 'Europe/London' }, end: { dateTime: '2026-10-25T11:00:00+00:00' }, recurringEventId: 'series', originalStartTime: { dateTime: '2026-10-25T09:00:00+00:00' }, iCalUID: 'uid', organizer: { email: 'owner@example.test' } }], nextPageToken: 'page2' },
    { items: [{ id: 'day', start: { date: '2026-10-25' }, end: { date: '2026-10-27' } }, { id: 'cancelled', status: 'cancelled' }] },
    {},
  ];
  const api = new CalendarApi(() => 'token', fakeFetch(pages, url => {
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('orderBy'), 'startTime');
    assert.equal(url.searchParams.get('showDeleted'), 'false');
    assert.equal(url.searchParams.get('timeMin'), rangeBounds(range).timeMin);
    if (request < 2) assert.ok(url.pathname.includes(encodeURIComponent(calendar.id)));
    assert.equal(url.searchParams.get('pageToken'), request++ === 1 ? 'page2' : null);
  }));
  const events = await api.listEvents([calendar, { ...calendar, id: 'empty' }], range, signal());
  assert.equal(events.length, 2);
  assert.equal(events[0].id, 'day');
  assert.deepEqual(events[0].end, { kind: 'date', date: '2026-10-27' });
  assert.equal(events[0].allDay, true);
  assert.equal(events[1].calendarId, calendar.id);
  assert.equal(events[1].calendarName, 'Shared');
  assert.equal(events[1].recurringEventId, 'series');
  assert.equal(events[1].iCalUID, 'uid');
  assert.equal(events[1].organizer?.email, 'owner@example.test');
  assert.equal(events[1].title, '<script>private text</script>');
  assert.deepEqual(events[1].originalStart, { kind: 'dateTime', dateTime: '2026-10-25T09:00:00+00:00', timeZone: undefined });
});

test('same Google ID in different calendars retains separate ownership', () => {
  const row = { id: 'same', start: { dateTime: '2026-10-25T09:00:00+01:00' }, end: { dateTime: '2026-10-25T10:00:00+01:00' } };
  const a = normalizeEvent(row, calendar)!;
  const b = normalizeEvent({ ...row, start: { dateTime: '2026-10-25T07:30:00Z' } }, { ...calendar, id: 'other' })!;
  assert.equal(a.title, '(Untitled event)');
  assert.deepEqual(sortEvents([a, b]).map(e => e.calendarId), ['other', calendar.id]);
});

test('empty selection and freebusy-only calendars make no event requests', async () => {
  const api = new CalendarApi(() => 'token', fakeFetch([]));
  assert.deepEqual(await api.listEvents([], range, signal()), []);
  assert.deepEqual(await api.listEvents([{ ...calendar, accessRole: 'freeBusyReader' }], range, signal()), []);
});

for (const status of [401, 403, 429, 500]) test(`HTTP ${status} becomes a safe actionable error`, async () => {
  const api = new CalendarApi(() => 'token', (async () => new Response('sensitive upstream error', { status })) as typeof fetch);
  await assert.rejects(api.listCalendars(signal()), (error: CalendarApiError) => {
    assert.equal(error.status, status);
    assert.ok(!error.message.includes('sensitive'));
    return true;
  });
});

test('aborted request cannot begin fetching', async () => {
  const controller = new AbortController();
  controller.abort();
  const api = new CalendarApi(() => 'token', fakeFetch([]));
  await assert.rejects(api.listCalendars(controller.signal), { name: 'AbortError' });
});

test('network failure and malformed/incomplete events reject rather than claim success', async () => {
  const api = new CalendarApi(() => 'token', (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch);
  await assert.rejects(api.listCalendars(signal()));
  assert.throws(() => normalizeEvent({ id: 'incomplete' }, calendar));
});
