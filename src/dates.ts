import type { CalendarEvent, DateRange, EventTime } from './types.ts';

export function dateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftMonths(today: Date, months: number): Date {
  const result = new Date(today.getFullYear(), today.getMonth() + months, 1);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(today.getDate(), lastDay));
  return result;
}

export function defaultRange(today = new Date()): DateRange {
  return { start: dateInput(shiftMonths(today, -2)), end: dateInput(shiftMonths(today, 10)) };
}

function localMidnight(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose valid start and end dates.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (dateInput(date) !== value) throw new Error('Choose valid start and end dates.');
  return date;
}

export function rangeBounds(range: DateRange): { timeMin: string; timeMax: string } {
  const start = localMidnight(range.start);
  const end = localMidnight(range.end);
  if (end <= start) throw new Error('The end date must be after the start date (end is exclusive).');
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

export function sortEvents(events: CalendarEvent[]): CalendarEvent[] {
  const instant = (time: EventTime) => time.kind === 'date'
    ? localMidnight(time.date).getTime() : Date.parse(time.dateTime);
  return events.sort((a, b) => instant(a.start) - instant(b.start)
    || a.calendarId.localeCompare(b.calendarId) || a.id.localeCompare(b.id));
}

export function formatTime(time: EventTime): string {
  // Show source timestamp/offset explicitly; no implicit browser-zone conversion.
  return time.kind === 'date' ? time.date
    : `${time.dateTime.replace('T', ' ')}${time.timeZone ? ` (${time.timeZone})` : ''}`;
}
