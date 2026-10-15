import type { Calendar, CalendarEvent, EventTime } from './types.ts';
import { CATEGORY_PROPERTY, categoryFor, isCategory } from './categories.ts';
import type { Category } from './categories.ts';
import { addDays, dateInZone } from './planner-layout.ts';

export type TimingMode = 'All day' | 'AM' | 'PM' | 'Evening' | 'Custom';
export const TIMING_PRESETS = { AM: ['08:00', '13:00'], PM: ['13:00', '18:00'], Evening: ['18:00', '23:00'] } as const;
export interface EventDraft {
  id: string; title: string; calendarId: string; category: Category; description: string;
  startDate: string; endDate: string; startTime: string; endTime: string;
  mode: TimingMode; timeZone: string;
}
export interface WriteTime { date?: string | null; dateTime?: string | null; timeZone?: string | null }
export interface EventBody {
  id?: string; summary: string; description: string;
  start?: WriteTime; end?: WriteTime;
  extendedProperties: { private?: Record<string, string>; shared: Record<string, string> };
}
export function canWriteCalendar(calendar: Calendar): boolean {
  return ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(calendar.accessRole);
}
export function editingReason(event: CalendarEvent, calendar?: Calendar): string {
  if (event.recurring || event.recurringEventId || event.originalStart) return 'Recurring events must be edited in Google Calendar; series and instances are read-only here.';
  if (event.eventType && event.eventType !== 'default') return 'This special event must be edited in Google Calendar.';
  if (!calendar || !canWriteCalendar(calendar)) return 'This calendar is read-only.';
  if (event.locked || (calendar.accessRole === 'writerWithoutPrivateAccess' && event.visibility === 'private')) return 'You do not have permission to edit this event.';
  if (event.organizer?.self === false && !event.guestsCanModify) return 'The organiser does not allow editing this event. Use Google Calendar.';
  return '';
}

function wallString(instant: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
function validateDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || addDays(date, 0) !== date) {
    throw new Error('Choose valid start and end dates.');
  }
}
// Find instants whose local clock exactly matches the entered wall time. This
// detects DST gaps/folds rather than letting Date silently shift or guess.
export function wallTimeToInstant(date: string, time: string, timeZone: string): string {
  validateDate(date);
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(time)) throw new Error('Choose valid start and end times.');
  const naive = Date.parse(`${date}T${time}Z`);
  const wall = `${date}T${time.length === 5 ? `${time}:00` : time.split('.')[0]}`;
  const offsets = new Set<number>();
  try {
    for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
      const sample = Math.floor((naive + hours * 3600000) / 1000) * 1000;
      offsets.add(Date.parse(`${wallString(sample, timeZone)}Z`) - sample);
    }
  } catch { throw new Error('Choose a valid IANA time zone, such as Europe/London.'); }
  const matches = [...offsets].map(offset => naive - offset).filter(instant => wallString(instant, timeZone) === wall);
  if (!matches.length) throw new Error('This local time does not exist because of daylight saving. Choose another time.');
  if (matches.length > 1) throw new Error('This local time occurs twice because of daylight saving. Choose an unambiguous time; unchanged existing timestamps are preserved.');
  return new Date(matches[0]).toISOString();
}
function draftTime(time: EventTime, timeZone: string): { date: string; time: string } {
  if (time.kind === 'date') return { date: time.date, time: '' };
  const instant = Date.parse(time.dateTime);
  const wall = wallString(instant, timeZone);
  const milliseconds = new Date(instant).getUTCMilliseconds();
  return { date: wall.slice(0, 10), time: wall.slice(11) + (milliseconds ? `.${String(milliseconds).padStart(3, '0')}` : '') };
}
export function newDraft(calendar: Calendar, today = dateInZone(Date.now(), 'Europe/London')): EventDraft {
  return { id: crypto.randomUUID().replaceAll('-', ''), title: '', calendarId: calendar.id, category: categoryFor({ calendarId: calendar.id } as CalendarEvent),
    description: '', startDate: today, endDate: today, startTime: '08:00', endTime: '13:00', mode: 'All day', timeZone: calendar.timeZone || 'Europe/London' };
}
export function draftFor(event: CalendarEvent): EventDraft {
  const timeZone = (event.start.kind === 'dateTime' && event.start.timeZone) || (event.end.kind === 'dateTime' && event.end.timeZone) || event.calendarTimeZone || 'Europe/London';
  const start = draftTime(event.start, timeZone);
  const end = draftTime(event.end, timeZone);
  return { id: event.id, title: event.title, calendarId: event.calendarId, category: categoryFor(event), description: event.description ?? '',
    startDate: start.date, endDate: event.allDay ? addDays(end.date, -1) : end.date,
    startTime: start.time || '08:00', endTime: end.time || '13:00', mode: event.allDay ? 'All day' : 'Custom', timeZone };
}
export function withTimingMode(draft: EventDraft, mode: TimingMode): EventDraft {
  if (mode === 'AM' || mode === 'PM' || mode === 'Evening') {
    const [startTime, endTime] = TIMING_PRESETS[mode];
    return { ...draft, mode, startTime, endTime };
  }
  if (mode === 'All day' && draft.mode !== 'All day' && /^00:00(?::00(?:\.0{1,3})?)?$/.test(draft.endTime) && draft.endDate > draft.startDate) {
    return { ...draft, mode, endDate: addDays(draft.endDate, -1) };
  }
  return { ...draft, mode };
}
function writeTime(time: EventTime): WriteTime {
  return time.kind === 'date' ? { date: time.date } : { dateTime: time.dateTime, ...(time.timeZone ? { timeZone: time.timeZone } : {}) };
}
export function bodyForDraft(draft: EventDraft, original?: CalendarEvent): EventBody {
  if (!draft.title.trim()) throw new Error('A title is required.');
  if (!isCategory(draft.category)) throw new Error('Choose a valid category.');
  validateDate(draft.startDate); validateDate(draft.endDate);
  if (original && draft.calendarId !== original.calendarId) throw new Error('Existing events must stay on their original calendar.');
  const body: EventBody = { summary: draft.title.trim(), description: draft.description,
    extendedProperties: { ...(original?.privateProperties ? { private: { ...original.privateProperties } } : {}),
      shared: { ...original?.sharedProperties, [CATEGORY_PROPERTY]: draft.category } } };
  const before = original ? draftFor(original) : undefined;
  const sameKind = before && (before.mode === 'All day') === (draft.mode === 'All day');
  const startUnchanged = sameKind && before.startDate === draft.startDate && (draft.mode === 'All day' || (before.startTime === draft.startTime && before.timeZone === draft.timeZone));
  const endUnchanged = sameKind && before.endDate === draft.endDate && (draft.mode === 'All day' || (before.endTime === draft.endTime && before.timeZone === draft.timeZone));
  let start: WriteTime;
  let end: WriteTime;
  if (draft.mode === 'All day') {
    if (draft.endDate < draft.startDate) throw new Error('The end date must not be before the start date.');
    start = { date: draft.startDate }; end = { date: addDays(draft.endDate, 1) };
  } else {
    start = startUnchanged ? writeTime(original!.start) : { dateTime: wallTimeToInstant(draft.startDate, draft.startTime, draft.timeZone), timeZone: draft.timeZone };
    end = endUnchanged ? writeTime(original!.end) : { dateTime: wallTimeToInstant(draft.endDate, draft.endTime, draft.timeZone), timeZone: draft.timeZone };
    if (Date.parse(end.dateTime!) <= Date.parse(start.dateTime!)) throw new Error('The end time must be after the start time. For overnight events, use the next end date.');
  }
  // Omit unchanged endpoints entirely: preserve original offsets, seconds,
  // precision and potentially different start/end zones when editing text only.
  if (!startUnchanged) body.start = start;
  if (!endUnchanged) body.end = end;
  if (original && !sameKind) {
    if (body.start) body.start = { date: null, dateTime: null, timeZone: null, ...body.start };
    if (body.end) body.end = { date: null, dateTime: null, timeZone: null, ...body.end };
  }
  return body;
}
