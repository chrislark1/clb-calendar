import test from 'node:test';
import assert from 'node:assert/strict';
import type { Calendar, CalendarEvent, DateRange } from '../src/types.ts';
import { CATEGORIES, categoryFor } from '../src/categories.ts';
import { addDays, addMonths, eventDates, eventKey, filterCalendars, initialHorizon, layoutMonth, monthGeometry, monthsIn, queryHorizon, navigationHorizon, MAX_HORIZON_MONTHS } from '../src/planner-layout.ts';
import { missingRanges, PlannerEvents } from '../src/planner-events.ts';

const calendar: Calendar = { id: 'one', name: 'One', timeZone: 'Europe/London', accessRole: 'owner', primary: true };
test('month navigation reuses the horizon, extends nearby edges, and bounds distant jumps', () => {
  const range = initialHorizon('2026-10-15');
  assert.deepEqual(navigationHorizon(range, '2026-11-01'), range);
  assert.deepEqual(navigationHorizon(range, '2027-09-01'), { ...range, end: '2027-10-01' });
  assert.deepEqual(navigationHorizon(range, '2026-07-01'), { ...range, start: '2026-07-01' });
  for (const date of ['1900-01-01', '2032-06-01', '2199-12-01']) {
    const next = navigationHorizon(range, date);
    assert.ok(monthsIn(next).includes(date));
    assert.ok(monthsIn(next).length <= MAX_HORIZON_MONTHS);
  }
});
function allDay(id: string, start: string, end: string, calendarId = 'one'): CalendarEvent {
  return { id, calendarId, calendarName: 'One', calendarTimeZone: 'Europe/London', title: id,
    start: { kind: 'date', date: start }, end: { kind: 'date', date: end }, allDay: true, endTimeUnspecified: false };
}
function timed(start: string, end: string): CalendarEvent {
  return { ...allDay('timed', '2026-01-01', '2026-01-02'), allDay: false,
    start: { kind: 'dateTime', dateTime: start }, end: { kind: 'dateTime', dateTime: end } };
}

test('rolling horizon covers two preceding, current and ten future months across years', () => {
  const horizon = initialHorizon('2026-10-14');
  assert.deepEqual(horizon, { start: '2026-08-01', end: '2027-09-01' });
  assert.equal(monthsIn(horizon).length, 13);
  assert.equal(addMonths('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.deepEqual(queryHorizon(horizon), { start: '2026-07-30', end: '2027-09-03' });
});

test('four, five and six-week months use Monday alignment and retain leap days', () => {
  assert.deepEqual(monthGeometry('2021-02-01'), { first: '2021-02-01', end: '2021-03-01', offset: 0, days: 28, weeks: 4 });
  assert.equal(monthGeometry('2026-10-01').weeks, 5);
  assert.equal(monthGeometry('2026-03-01').weeks, 6);
  assert.equal(monthGeometry('2024-02-01').days, 29);
  for (const month of monthsIn({ start: '2026-01-01', end: '2028-01-01' })) {
    const geometry = monthGeometry(month);
    for (let day = 0; day < geometry.days; day++) {
      const weekday = (new Date(`${addDays(month, day)}T00:00:00Z`).getUTCDay() + 6) % 7;
      assert.equal((geometry.offset + day) % 7, weekday);
    }
  }
});

test('all-day exclusive ends occupy only relevant dates', () => {
  const row = layoutMonth('2026-10-01', [allDay('one', '2026-10-14', '2026-10-15')], 'Europe/London');
  assert.equal(row.segments[0].span, 1);
  assert.equal(row.segments[0].column, 16);
  assert.equal(layoutMonth('2026-11-01', [allDay('oct', '2026-10-31', '2026-11-01')], 'Europe/London').segments.length, 0);
});

test('timed events use intersected dates and an exclusive midnight end', () => {
  assert.deepEqual(eventDates(timed('2026-10-14T23:30:00+01:00', '2026-10-15T01:00:00+01:00'), 'Europe/London'), { start: '2026-10-14', end: '2026-10-16' });
  assert.deepEqual(eventDates(timed('2026-10-14T23:30:00+01:00', '2026-10-15T00:00:00+01:00'), 'Europe/London'), { start: '2026-10-14', end: '2026-10-15' });
  assert.deepEqual(eventDates(timed('2026-10-14T23:30:00+01:00', '2026-10-14T23:30:00+01:00'), 'Europe/London'), { start: '2026-10-14', end: '2026-10-15' });
});

test('timed events convert source offsets into a consistent planner zone', () => {
  const event = timed('2026-10-14T23:30:00-07:00', '2026-10-15T00:30:00-07:00');
  assert.deepEqual(eventDates(event, 'Europe/London'), { start: '2026-10-15', end: '2026-10-16' });
  assert.deepEqual(eventDates(event, 'America/Los_Angeles'), { start: '2026-10-14', end: '2026-10-16' });
  assert.equal(event.start.kind === 'dateTime' && event.start.dateTime, '2026-10-14T23:30:00-07:00');
});

test('DST spring/fall transitions and both repeated clock hours keep correct civil dates', () => {
  for (const [start, end, expected] of [
    ['2026-03-28T23:30:00Z', '2026-03-30T00:00:00+01:00', { start: '2026-03-28', end: '2026-03-30' }],
    ['2026-10-24T23:30:00+01:00', '2026-10-26T00:00:00Z', { start: '2026-10-24', end: '2026-10-26' }],
    ['2026-10-25T01:15:00+01:00', '2026-10-25T01:45:00Z', { start: '2026-10-25', end: '2026-10-26' }],
  ] as const) assert.deepEqual(eventDates(timed(start, end), 'Europe/London'), expected);
});

test('month and year segments retain original identity and continuation indicators', () => {
  const event = allDay('year', '2026-12-30', '2027-01-03');
  const december = layoutMonth('2026-12-01', [event], 'Europe/London').segments[0];
  const january = layoutMonth('2027-01-01', [event], 'Europe/London').segments[0];
  assert.equal(december.span, 2);
  assert.equal(january.span, 2);
  assert.equal(december.continuesAfter, true);
  assert.equal(january.continuesBefore, true);
  assert.equal(december.event, january.event);
  assert.equal(eventKey(december.event), eventKey(january.event));
  const atBoundary = allDay('boundary', '2026-12-31', '2027-01-01');
  assert.equal(layoutMonth('2027-01-01', [atBoundary], 'Europe/London').segments.length, 0);
});

test('multi-month event uses one continuous segment per month, including full months', () => {
  const event = allDay('long', '2026-09-29', '2026-12-02');
  for (const [month, length] of [['2026-09-01', 2], ['2026-10-01', 31], ['2026-11-01', 30], ['2026-12-01', 1]] as const) {
    const layout = layoutMonth(month, [event], 'Europe/London');
    assert.equal(layout.segments.length, 1);
    assert.equal(layout.segments[0].span, length);
  }
});

test('tracks pack deterministically with adjacent ranges sharing the lowest available track', () => {
  const events = [allDay('short', '2026-10-01', '2026-10-02'), allDay('long', '2026-10-01', '2026-10-04'),
    allDay('adjacent', '2026-10-04', '2026-10-05'), allDay('overlap', '2026-10-02', '2026-10-03')];
  const layout = layoutMonth('2026-10-01', events, 'Europe/London');
  assert.deepEqual(layout, layoutMonth('2026-10-01', [...events].reverse(), 'Europe/London'));
  assert.equal(layout.tracks, 2);
  assert.equal(layout.segments.find(s => s.event.id === 'long')!.track, 0);
  assert.equal(layout.segments.find(s => s.event.id === 'adjacent')!.track, 0);
  assert.equal(layout.segments.find(s => s.event.id === 'overlap')!.track, 1);
  for (const a of layout.segments) for (const b of layout.segments) {
    if (a !== b && a.track === b.track) assert.ok(a.end <= b.start || b.end <= a.start);
  }
  assert.equal(layoutMonth('2026-11-01', [], 'Europe/London').tracks, 0);
});

test('calendar filtering is independent of category and identical Google event IDs', () => {
  const a = allDay('same', '2026-10-01', '2026-10-02', 'one');
  const b = { ...a, calendarId: 'two' };
  assert.deepEqual(filterCalendars([a, b], ['two']), [b]);
  assert.deepEqual(filterCalendars([a, b], []), []);
  assert.notEqual(eventKey(a), eventKey(b));
  assert.equal(categoryFor(a), 'Other');
  assert.equal(categoryFor(a, { one: 'Social' }), 'Social');
  assert.equal(categoryFor(b, { one: 'Social' }), 'Other');
});

test('category fills maintain readable small-text contrast', () => {
  function luminance(hex: string) {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  }
  for (const [name, palette] of Object.entries(CATEGORIES)) {
    const values = [luminance(palette.color), luminance(palette.text)].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, name);
  }
});

test('coverage detects only missing edges and holes, regardless of input order', () => {
  const request = { start: '2026-01-01', end: '2026-06-01' };
  assert.deepEqual(missingRanges(request, [{ start: '2026-03-01', end: '2026-05-01' }, { start: '2026-02-01', end: '2026-03-01' }]), [
    { start: '2026-01-01', end: '2026-02-01' }, { start: '2026-05-01', end: '2026-06-01' },
  ]);
  assert.deepEqual(missingRanges(request, [{ start: '2025-01-01', end: '2027-01-01' }]), []);
});

test('session cache reuses ranges and hidden calendars, expands incrementally and deduplicates spanning events', async () => {
  const cache = new PlannerEvents();
  const requests: unknown[] = [];
  const event = allDay('span', '2026-01-25', '2026-03-05');
  const api = { async listEvents(calendars: Calendar[], range: { start: string; end: string }) { requests.push({ ids: calendars.map(c => c.id), range }); return [event]; } };
  const controller = new AbortController();
  const january = { start: '2026-01-01', end: '2026-02-01' };
  await cache.load(api, [calendar], january, controller.signal);
  await cache.load(api, [], january, controller.signal);
  await cache.load(api, [calendar], january, controller.signal);
  assert.equal(requests.length, 1);
  const events = await cache.load(api, [calendar], { start: '2025-12-01', end: '2026-03-01' }, controller.signal);
  assert.equal(events.length, 1);
  assert.deepEqual(requests.slice(1), [
    { ids: ['one'], range: { start: '2025-12-01', end: '2026-01-01' } },
    { ids: ['one'], range: { start: '2026-02-01', end: '2026-03-01' } },
  ]);
  cache.clear();
  await cache.load(api, [calendar], january, controller.signal);
  assert.equal(requests.length, 4, 'manual refresh invalidates coverage');
});

test('failed or cancelled retrieval never commits partial session coverage', async () => {
  for (const abort of [false, true]) {
    const cache = new PlannerEvents();
    const controller = new AbortController();
    let calls = 0;
    const api = { async listEvents() {
      calls++;
      if (calls === 2) { if (abort) controller.abort(); else throw new Error('failed'); }
      return [];
    } };
    const range = { start: '2026-01-01', end: '2026-02-01' };
    await assert.rejects(cache.load(api, [calendar, { ...calendar, id: 'two' }], range, controller.signal));
    await cache.load(api, [calendar], range, new AbortController().signal);
    assert.equal(calls, 3, 'first calendar must be fetched again because transaction never committed');
  }
});

test('horizon retention evicts distant events and coverage while retaining overlap and hidden-calendar data', async () => {
  const cache = new PlannerEvents();
  const signal = new AbortController().signal;
  const calls: DateRange[] = [];
  const api = { async listEvents(_calendars: Calendar[], range: DateRange) {
    calls.push(range); return range.start < '2030-01-01' ? [allDay('old', '2026-10-01', '2026-10-02'), allDay('span', '2026-10-01', '2033-01-01')] : [allDay('future', '2032-06-01', '2032-06-02')];
  } };
  const old = { start: '2026-08-01', end: '2027-09-01' };
  await cache.load(api, [calendar], old, signal);
  cache.retain({ start: '2026-09-01', end: '2027-09-01' });
  await cache.load(api, [calendar], { start: '2026-10-01', end: '2027-01-01' }, signal);
  assert.equal(calls.length, 1, 'overlapping retained coverage avoids refetch');
  const future = { start: '2032-04-01', end: '2033-05-01' };
  cache.retain(future);
  const rows = await cache.load(api, [calendar], future, signal);
  assert.deepEqual(rows.map(event => event.id).sort(), ['future', 'span']);
  cache.retain(old);
  await cache.load(api, [calendar], old, signal);
  assert.equal(calls.length, 3, 'evicted coverage is fetched again when revisited');
});
