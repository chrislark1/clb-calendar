import test from 'node:test';
import assert from 'node:assert/strict';
import type { Calendar, CalendarEvent } from '../src/types.ts';
import { CalendarApi, CalendarApiError, normalizeEvent } from '../src/calendar-api.ts';
import { CATEGORY_PROPERTY, categoryFor } from '../src/categories.ts';
import { bodyForDraft, canWriteCalendar, draftFor, editingReason, newDraft, wallTimeToInstant, withTimingMode } from '../src/editor-model.ts';
import { PlannerEvents } from '../src/planner-events.ts';

const calendar: Calendar = { id: 'shared/example.test', name: 'Shared', accessRole: 'writer', primary: true, timeZone: 'Europe/London' };
const raw = { id: 'abcde', etag: '"v1"', summary: 'Existing', start: { date: '2026-10-14' }, end: { date: '2026-10-16' },
  extendedProperties: { private: { foreign: 'private' }, shared: { foreign: 'shared' } } };
const event = normalizeEvent(raw, calendar)!;
const signal = () => new AbortController().signal;
function transport(responses: { status?: number; body?: unknown }[], requests: { url: string; init: RequestInit }[]) {
  return (async (input, init) => {
    requests.push({ url: String(input), init: init! });
    assert.ok(responses.length, 'unexpected request');
    const response = responses.shift()!;
    return new Response(response.status === 204 ? null : JSON.stringify(response.body ?? {}), { status: response.status ?? 200 });
  }) as typeof fetch;
}

test('new events are all-day, category defaults are separate and IDs are valid Google IDs', () => {
  const draft = newDraft(calendar, '2026-10-14');
  assert.equal(draft.mode, 'All day');
  assert.equal(draft.timeZone, 'Europe/London');
  assert.match(draft.id, /^[0-9a-v]{32}$/);
  assert.equal(draft.category, 'Other');
  assert.notEqual(draft.id, newDraft(calendar).id);
});

test('inclusive all-day ends convert to exclusive ends across month/year/leap boundaries', () => {
  for (const [start, end, exclusive] of [['2026-12-31', '2026-12-31', '2027-01-01'], ['2024-02-28', '2024-02-29', '2024-03-01'], ['2026-10-14', '2026-10-16', '2026-10-17']]) {
    const body = bodyForDraft({ ...newDraft(calendar), title: 'New', startDate: start, endDate: end });
    assert.deepEqual(body.start, { date: start });
    assert.deepEqual(body.end, { date: exclusive });
  }
  assert.equal(draftFor(event).endDate, '2026-10-15');
  const unchanged = bodyForDraft(draftFor(event), event);
  assert.equal(unchanged.start, undefined);
  assert.equal(unchanged.end, undefined);
});

test('AM/PM/Evening shortcuts are clock times, and Custom preserves shortcut times', () => {
  const draft = { ...newDraft(calendar, '2026-10-14'), title: 'Session' };
  for (const [mode, start, end] of [['AM', '08:00', '13:00'], ['PM', '13:00', '18:00'], ['Evening', '18:00', '23:00']] as const) {
    const shortcut = withTimingMode(draft, mode);
    assert.equal(shortcut.startTime, start);
    assert.equal(shortcut.endTime, end);
    assert.equal(withTimingMode(shortcut, 'Custom').startTime, start);
    const body = bodyForDraft(shortcut);
    assert.equal(body.start?.timeZone, 'Europe/London');
    assert.equal(body.start?.dateTime, wallTimeToInstant('2026-10-14', start, 'Europe/London'));
  }
});

test('time-zone conversion handles summer/winter, overnight and non-London zones', () => {
  assert.equal(wallTimeToInstant('2026-07-01', '08:00', 'Europe/London'), '2026-07-01T07:00:00.000Z');
  assert.equal(wallTimeToInstant('2026-12-01', '08:00', 'Europe/London'), '2026-12-01T08:00:00.000Z');
  assert.equal(wallTimeToInstant('2026-07-01', '08:00', 'America/New_York'), '2026-07-01T12:00:00.000Z');
  const body = bodyForDraft({ ...newDraft(calendar), title: 'Overnight', mode: 'Custom', startDate: '2026-03-28', startTime: '23:30', endDate: '2026-03-29', endTime: '03:30' });
  assert.equal(body.start?.dateTime, '2026-03-28T23:30:00.000Z');
  assert.equal(body.end?.dateTime, '2026-03-29T02:30:00.000Z');
});

test('DST gaps and ambiguous folds are rejected instead of guessed', () => {
  assert.throws(() => wallTimeToInstant('2026-03-29', '01:30', 'Europe/London'), /does not exist/);
  assert.throws(() => wallTimeToInstant('2026-10-25', '01:30', 'Europe/London'), /occurs twice/);
  assert.throws(() => wallTimeToInstant('2026-10-14', '08:00', 'Invalid/Zone'), /valid IANA/);
});

test('text/category edits preserve exact existing times, fractions, offsets and endpoint zones', () => {
  const timed = normalizeEvent({ ...raw, start: { dateTime: '2026-10-25T01:15:12.123+01:00', timeZone: 'Europe/London' },
    end: { dateTime: '2026-10-25T01:45:45.456+00:00', timeZone: 'UTC' } }, calendar)!;
  const draft = draftFor(timed);
  assert.equal(draft.mode, 'Custom');
  assert.equal(draft.startTime, '01:15:12.123');
  const body = bodyForDraft({ ...draft, title: 'Renamed', category: 'Sport' }, timed);
  assert.equal(body.start, undefined);
  assert.equal(body.end, undefined);
  assert.equal(body.extendedProperties.shared[CATEGORY_PROPERTY], 'Sport');
  const endChanged = bodyForDraft({ ...draft, endTime: '02:30:00' }, timed);
  assert.equal(endChanged.start, undefined);
  assert.equal(endChanged.end?.dateTime, '2026-10-25T02:30:00.000Z');
});

test('switching timing kind explicitly clears incompatible Google date fields', () => {
  const body = bodyForDraft(withTimingMode(draftFor(event), 'AM'), event);
  assert.equal(body.start?.date, null);
  assert.ok(body.start?.dateTime);
  const timed = normalizeEvent({ ...raw, start: { dateTime: '2026-10-14T08:00:00+01:00' }, end: { dateTime: '2026-10-15T13:00:00+01:00' } }, calendar)!;
  const allDay = bodyForDraft(withTimingMode(draftFor(timed), 'All day'), timed);
  assert.equal(allDay.start?.dateTime, null);
  assert.equal(allDay.start?.timeZone, null);
  assert.equal(allDay.end?.date, '2026-10-16');
});

test('switching a timed midnight end to all-day keeps the last occupied date inclusive', () => {
  const timed = normalizeEvent({ ...raw, start: { dateTime: '2026-10-14T23:00:00+01:00' }, end: { dateTime: '2026-10-15T00:00:00+01:00' } }, calendar)!;
  const draft = withTimingMode(draftFor(timed), 'All day');
  assert.equal(draft.endDate, '2026-10-14');
  assert.equal(bodyForDraft(draft, timed).end?.date, '2026-10-15');
});

test('invalid titles/dates/order and moving calendars are rejected', () => {
  const draft = { ...newDraft(calendar, '2026-10-14'), title: 'New' };
  assert.throws(() => bodyForDraft({ ...draft, title: '  ' }), /title/);
  assert.throws(() => bodyForDraft({ ...draft, startDate: '2026-02-30' }), /valid/);
  assert.throws(() => bodyForDraft({ ...draft, endDate: '2026-10-13' }), /before/);
  assert.throws(() => bodyForDraft({ ...draft, mode: 'Custom', startTime: '23:00', endTime: '01:00' }), /overnight/);
  assert.throws(() => bodyForDraft({ ...draftFor(event), calendarId: 'another' }, event), /original calendar/);
});

test('category metadata wins over calendar defaults, with invalid values falling back safely', () => {
  const explicit = { ...event, sharedProperties: { [CATEGORY_PROPERTY]: 'Wedding', outside: 'keep' } };
  assert.equal(categoryFor(explicit, { [calendar.id]: 'Social' }), 'Wedding');
  assert.equal(categoryFor({ ...event, sharedProperties: { [CATEGORY_PROPERTY]: 'Unknown' } }, { [calendar.id]: 'Social' }), 'Social');
  assert.equal(categoryFor({ ...event, sharedProperties: {} }), 'Other');
});

test('calendar roles, private access, locked/guest/special/recurring events restrict editing', () => {
  for (const role of ['reader', 'freeBusyReader', 'none']) assert.equal(canWriteCalendar({ ...calendar, accessRole: role }), false);
  for (const role of ['owner', 'writer', 'writerWithoutPrivateAccess']) assert.equal(canWriteCalendar({ ...calendar, accessRole: role }), true);
  assert.equal(editingReason(event, calendar), '');
  for (const restricted of [{ ...event, recurringEventId: 'parent' }, { ...event, recurring: true }, { ...event, locked: true },
    { ...event, eventType: 'birthday' }, { ...event, organizer: { self: false } }]) assert.ok(editingReason(restricted, calendar));
  assert.equal(editingReason({ ...event, organizer: { self: false }, guestsCanModify: true }, calendar), '');
  assert.ok(editingReason(normalizeEvent({ ...raw, organizer: { email: 'guest@example.test' } }, calendar)!, calendar), 'omitted organizer.self defaults to false');
  assert.ok(editingReason({ ...event, visibility: 'private' }, { ...calendar, accessRole: 'writerWithoutPrivateAccess' }));
});

test('POST creates a normalised event with stable ID, category and exclusive dates', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const draft = { ...newDraft(calendar, '2026-10-14'), title: 'New', category: 'Social' as const };
  const api = new CalendarApi(() => 'token', transport([{ body: { ...raw, id: draft.id, summary: draft.title, end: { date: '2026-10-15' },
    extendedProperties: { shared: { [CATEGORY_PROPERTY]: 'Social' } } } }], requests));
  const saved = await api.createEvent(calendar, draft, signal());
  assert.equal(saved.calendarId, calendar.id);
  assert.equal(categoryFor(saved), 'Social');
  assert.equal(requests[0].init.method, 'POST');
  assert.ok(requests[0].url.includes(encodeURIComponent(calendar.id)));
  const payload = JSON.parse(requests[0].init.body as string);
  assert.equal(payload.id, draft.id);
  assert.equal(payload.end.date, '2026-10-15');
});

test('PATCH fresh metadata preserves unrelated fields and unchanged timestamps with If-Match', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const current = { ...raw, extendedProperties: { private: { freshPrivate: 'yes' }, shared: { freshShared: 'yes' } } };
  const api = new CalendarApi(() => 'token', transport([{ body: current }, { body: { ...current, summary: 'Updated' } }], requests));
  await api.updateEvent(calendar, event, { ...draftFor(event), title: 'Updated', category: 'Garden' }, signal());
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[1].init.method, 'PATCH');
  assert.equal((requests[1].init.headers as Record<string, string>)['If-Match'], '"v1"');
  const body = JSON.parse(requests[1].init.body as string);
  assert.equal(body.start, undefined); assert.equal(body.end, undefined);
  assert.deepEqual(body.extendedProperties, { private: { freshPrivate: 'yes' }, shared: { freshShared: 'yes', [CATEGORY_PROPERTY]: 'Garden' } });
  assert.equal(body.attendees, undefined); assert.equal(body.location, undefined); assert.equal(body.recurrence, undefined);
});

test('DELETE checks latest version and handles a body-free 204 response', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const api = new CalendarApi(() => 'token', transport([{ body: raw }, { status: 204 }], requests));
  await api.deleteEvent(calendar, event, signal());
  assert.equal(requests[1].init.method, 'DELETE');
  assert.equal((requests[1].init.headers as Record<string, string>)['If-Match'], '"v1"');
  assert.equal(requests[1].init.body, undefined);
});

test('recurrence, permission and concurrent-change guards prevent writes, including new server recurrence', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const api = new CalendarApi(() => 'token', transport([{ body: { ...raw, etag: '"v2"' } }, { body: { ...raw, recurrence: ['RRULE:FREQ=DAILY'] } }], requests));
  await assert.rejects(api.createEvent({ ...calendar, accessRole: 'reader' }, { ...newDraft(calendar), title: 'No' }, signal()), /read-only/);
  await assert.rejects(api.deleteEvent(calendar, { ...event, recurringEventId: 'parent' }, signal()), /Recurring/);
  assert.equal(requests.length, 0);
  await assert.rejects(api.updateEvent(calendar, event, draftFor(event), signal()), (error: CalendarApiError) => error.status === 412);
  await assert.rejects(api.deleteEvent(calendar, event, signal()), /Recurring/);
  assert.ok(requests.every(request => request.init.method === 'GET'));
});

for (const status of [401, 403, 404, 412, 500]) test(`mutation API error ${status} remains actionable without raw event content`, async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const api = new CalendarApi(() => 'token', transport([{ status, body: { summary: 'sensitive' } }], requests));
  await assert.rejects(api.createEvent(calendar, { ...newDraft(calendar), title: 'New' }, signal()), (error: CalendarApiError) => error.status === status && !error.message.includes('sensitive'));
});

test('duplicate submissions are blocked while a mutation is in flight', async () => {
  let release!: () => void;
  let calls = 0;
  const draft = { ...newDraft(calendar), title: 'New' };
  const api = new CalendarApi(() => 'token', (async () => {
    calls++; await new Promise<void>(resolve => { release = resolve; });
    return Response.json({ ...raw, id: draft.id });
  }) as typeof fetch);
  const first = api.createEvent(calendar, draft, signal());
  await assert.rejects(api.createEvent(calendar, draft, signal()), /in progress/);
  assert.equal(calls, 1); release(); await first;
});

test('create retry recovers the existing matching event on 409 instead of duplicating it', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const draft = { ...newDraft(calendar, '2026-10-14'), title: 'Recovered', category: 'Social' as const };
  const savedRaw = { ...raw, id: draft.id, summary: 'Recovered', end: { date: '2026-10-15' }, extendedProperties: { shared: { [CATEGORY_PROPERTY]: 'Social' } } };
  const api = new CalendarApi(() => 'token', transport([{ status: 409 }, { body: savedRaw }, { status: 409 }, { body: { ...savedRaw, summary: 'Different' } }], requests));
  assert.equal((await api.createEvent(calendar, draft, signal())).id, draft.id);
  await assert.rejects(api.createEvent(calendar, draft, signal()), /different values/);
  assert.deepEqual(requests.map(request => request.init.method), ['POST', 'GET', 'POST', 'GET']);
});

test('successful mutation invalidation reloads only its calendar while preserving other cached data', async () => {
  const cache = new PlannerEvents();
  const calendars = [calendar, { ...calendar, id: 'other' }];
  const calls: string[] = [];
  const api = { async listEvents(rows: Calendar[]) { calls.push(rows[0].id); return [{ ...event, calendarId: rows[0].id }]; } };
  const range = { start: '2026-10-01', end: '2026-11-01' };
  await cache.load(api, calendars, range, signal());
  cache.invalidate(calendar.id);
  const events = await cache.load(api, calendars, range, signal());
  assert.deepEqual(calls, [calendar.id, 'other', calendar.id]);
  assert.equal(events.length, 2);
});
