import type { Calendar, CalendarEvent, DateRange } from './types.ts';
import type { CalendarApi } from './calendar-api.ts';
import { eventDates, eventKey } from './planner-layout.ts';

export function missingRanges(request: DateRange, covered: readonly DateRange[]): DateRange[] {
  let cursor = request.start;
  const missing: DateRange[] = [];
  for (const range of [...covered].sort((a, b) => a.start.localeCompare(b.start))) {
    if (range.end <= cursor || range.start >= request.end) continue;
    if (range.start > cursor) missing.push({ start: cursor, end: range.start });
    cursor = range.end > cursor ? range.end : cursor;
    if (cursor >= request.end) break;
  }
  if (cursor < request.end) missing.push({ start: cursor, end: request.end });
  return missing;
}

interface CalendarData { covered: DateRange[]; events: Map<string, CalendarEvent> }
// One session-owned cache. Complete requests commit together; no storage or sync.
export class PlannerEvents {
  private calendars = new Map<string, CalendarData>();
  clear(): void { this.calendars.clear(); }
  invalidate(calendarId: string): void { this.calendars.delete(calendarId); }
  retain(range: DateRange): void {
    for (const data of this.calendars.values()) {
      data.covered = data.covered.map(saved => ({ start: saved.start > range.start ? saved.start : range.start,
        end: saved.end < range.end ? saved.end : range.end })).filter(saved => saved.start < saved.end);
      for (const [key, event] of data.events) {
        const dates = eventDates(event, event.calendarTimeZone || 'Europe/London');
        if (dates.end <= range.start || dates.start >= range.end) data.events.delete(key);
      }
    }
  }

  async load(api: Pick<CalendarApi, 'listEvents'>, calendars: Calendar[], range: DateRange, signal: AbortSignal): Promise<CalendarEvent[]> {
    const next = new Map(this.calendars);
    for (const calendar of calendars) {
      signal.throwIfAborted();
      const saved = next.get(calendar.id);
      const data = { covered: [...(saved?.covered ?? [])], events: new Map(saved?.events) };
      for (const missing of missingRanges(range, data.covered)) {
        const events = await api.listEvents([calendar], missing, signal);
        for (const event of events) data.events.set(eventKey(event), event);
        data.covered.push(missing);
      }
      // A renamed calendar must also update details of already cached events.
      for (const [key, event] of data.events) data.events.set(key, { ...event, calendarName: calendar.name, calendarTimeZone: calendar.timeZone });
      next.set(calendar.id, data);
    }
    signal.throwIfAborted();
    this.calendars = next;
    return [...next.values()].flatMap(data => [...data.events.values()]);
  }
}
