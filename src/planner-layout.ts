import type { CalendarEvent, DateRange, EventTime } from './types.ts';
import { dateInput } from './dates.ts';

export const DAY_COLUMNS = 42;
export const MIN_DAY_WIDTH = 27;
export const MONTH_LABEL_WIDTH = 48;
const DAY_MS = 86400000;

// Civil-day arithmetic in UTC avoids local DST changing the length of a day.
function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}
export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}
export function monthStart(date: string): string { return `${date.slice(0, 7)}-01`; }
export function addMonths(date: string, months: number): string {
  const [year, month] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}
export function initialHorizon(today = dateInput(new Date())): DateRange {
  return { start: addMonths(today, -2), end: addMonths(today, 11) };
}
export const MAX_HORIZON_MONTHS = 36;
export function navigationHorizon(range: DateRange, date: string): DateRange {
  const start = monthStart(date) < range.start ? monthStart(date) : range.start;
  const end = date >= range.end ? addMonths(date, 1) : range.end;
  const distance = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7));
  return distance > MAX_HORIZON_MONTHS ? initialHorizon(date) : { start, end };
}
export function monthsIn(range: DateRange): string[] {
  const months: string[] = [];
  for (let month = monthStart(range.start); month < range.end; month = addMonths(month, 1)) months.push(month);
  return months;
}
export function monthGeometry(month: string) {
  const first = monthStart(month);
  const end = addMonths(first, 1);
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = dayNumber(end) - dayNumber(first);
  return { first, end, offset, days, weeks: Math.ceil((offset + days) / 7) };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateInZone(instant: number, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(instant));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function timestamp(time: EventTime): number {
  if (time.kind !== 'dateTime') throw new Error('Expected a timed event.');
  // Normalised Google REST dateTimes contain an explicit RFC3339 offset.
  const instant = Date.parse(time.dateTime);
  if (!Number.isFinite(instant)) throw new Error('Invalid event timestamp.');
  return instant;
}

export function eventDates(event: CalendarEvent, timeZone: string): DateRange {
  if (event.start.kind === 'date' && event.end.kind === 'date') {
    return { start: event.start.date, end: event.end.date };
  }
  const start = timestamp(event.start);
  const end = timestamp(event.end);
  // One millisecond before an exclusive end belongs to the last occupied date,
  // including midnight and DST transitions. A zero-duration event occupies its start date.
  return { start: dateInZone(start, timeZone), end: addDays(dateInZone(Math.max(start, end - 1), timeZone), 1) };
}

export function eventKey(event: CalendarEvent): string {
  return JSON.stringify([event.calendarId, event.id]);
}
export function filterCalendars(events: CalendarEvent[], selected: readonly string[]): CalendarEvent[] {
  const ids = new Set(selected);
  return events.filter(event => ids.has(event.calendarId));
}

export interface EventSegment {
  event: CalendarEvent;
  start: string;
  end: string;
  column: number;
  span: number;
  track: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}
export interface MonthLayout {
  month: string;
  offset: number;
  days: number;
  weeks: number;
  tracks: number;
  segments: EventSegment[];
}
export function layoutMonth(month: string, events: CalendarEvent[], timeZone: string): MonthLayout {
  const geometry = monthGeometry(month);
  const segments: EventSegment[] = [];
  for (const event of events) {
    const dates = eventDates(event, timeZone);
    const start = dates.start > geometry.first ? dates.start : geometry.first;
    const end = dates.end < geometry.end ? dates.end : geometry.end;
    if (end <= start) continue;
    segments.push({ event, start, end, column: geometry.offset + dayNumber(start) - dayNumber(geometry.first),
      span: dayNumber(end) - dayNumber(start), track: 0,
      continuesBefore: dates.start < geometry.first, continuesAfter: dates.end > geometry.end });
  }
  // Stable tie-breaks independent of fetch order, titles or calendar selection order.
  segments.sort((a, b) => a.column - b.column || b.span - a.span || eventKey(a.event).localeCompare(eventKey(b.event), 'en'));
  const trackEnds: number[] = [];
  for (const segment of segments) {
    let track = trackEnds.findIndex(end => end <= segment.column);
    if (track < 0) track = trackEnds.length;
    segment.track = track;
    trackEnds[track] = segment.column + segment.span;
  }
  return { month: geometry.first, offset: geometry.offset, days: geometry.days, weeks: geometry.weeks,
    tracks: trackEnds.length, segments };
}

// Padding covers calendars whose all-day dates are interpreted by Google in a
// different zone. Layout clips these extra events to the visible civil dates.
export function queryHorizon(range: DateRange): DateRange {
  return { start: addDays(range.start, -2), end: addDays(range.end, 2) };
}
