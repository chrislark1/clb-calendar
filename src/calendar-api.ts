import type { Calendar, CalendarEvent, DateRange, EventTime } from './types.ts';
import { rangeBounds, sortEvents } from './dates.ts';

interface GoogleTime { date?: string; dateTime?: string; timeZone?: string }
interface GoogleEvent {
  id: string; summary?: string; description?: string; location?: string;
  start?: GoogleTime; end?: GoogleTime; originalStartTime?: GoogleTime;
  recurringEventId?: string; iCalUID?: string; status?: string; visibility?: string;
  eventType?: string; updated?: string; endTimeUnspecified?: boolean;
  organizer?: { email?: string; displayName?: string; self?: boolean };
}
interface GoogleCalendar {
  id: string; summary: string; summaryOverride?: string; description?: string;
  backgroundColor?: string; foregroundColor?: string; colorId?: string;
  accessRole: string; timeZone?: string; primary?: boolean;
}

export class CalendarApiError extends Error {
  status: number;
  constructor(status: number) {
    super(status === 401 ? 'Your Google session expired. Sign in again.'
      : status === 403 ? 'Google denied access. Check Calendar permissions, API enablement, or quota, then retry.'
      : status === 429 ? 'Google is receiving too many requests. Wait and refresh.'
      : `Calendar request failed (${status}). Please retry.`);
    this.status = status;
  }
}

export function canReadEvents(calendar: Calendar): boolean {
  return ['reader', 'writer', 'owner', 'writerWithoutPrivateAccess'].includes(calendar.accessRole);
}

function normalizeTime(time: GoogleTime): EventTime {
  if (time.date) return { kind: 'date', date: time.date };
  if (time.dateTime) return { kind: 'dateTime', dateTime: time.dateTime, timeZone: time.timeZone };
  throw new Error('Google returned an event without a date or time.');
}

export function normalizeEvent(event: GoogleEvent, calendar: Calendar): CalendarEvent | undefined {
  if (event.status === 'cancelled') return undefined;
  if (!event.start || !event.end) throw new Error('Google returned an incomplete event. Please refresh.');
  const start = normalizeTime(event.start);
  return {
    id: event.id, calendarId: calendar.id, calendarName: calendar.name,
    calendarTimeZone: calendar.timeZone, title: event.summary || '(Untitled event)',
    description: event.description, location: event.location,
    start, end: normalizeTime(event.end), allDay: start.kind === 'date',
    endTimeUnspecified: Boolean(event.endTimeUnspecified), recurringEventId: event.recurringEventId,
    originalStart: event.originalStartTime ? normalizeTime(event.originalStartTime) : undefined,
    iCalUID: event.iCalUID, status: event.status, visibility: event.visibility,
    eventType: event.eventType, updated: event.updated,
    organizer: event.organizer ? { email: event.organizer.email, name: event.organizer.displayName, self: event.organizer.self } : undefined,
  };
}

export class CalendarApi {
  private getToken: () => string;
  private fetcher: typeof fetch;
  // Native browser fetch must retain Window as its receiver when stored on this instance.
  constructor(getToken: () => string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.getToken = getToken;
    this.fetcher = fetcher;
  }

  private async pages<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T[]> {
    const result: T[] = [];
    let pageToken: string | undefined;
    do {
      signal.throwIfAborted();
      const query = new URLSearchParams(params);
      if (pageToken) query.set('pageToken', pageToken);
      const response = await this.fetcher(`https://www.googleapis.com/calendar/v3/${path}?${query}`, {
        headers: { Authorization: `Bearer ${this.getToken()}` }, signal,
        cache: 'no-store', credentials: 'omit',
      });
      if (!response.ok) throw new CalendarApiError(response.status);
      const page = await response.json() as { items?: T[]; nextPageToken?: string };
      result.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return result;
  }

  async listCalendars(signal: AbortSignal): Promise<Calendar[]> {
    const calendars = await this.pages<GoogleCalendar>('users/me/calendarList', { maxResults: '250', showHidden: 'true' }, signal);
    return calendars.map(c => ({
      id: c.id, name: c.summaryOverride || c.summary, description: c.description,
      color: c.backgroundColor, foregroundColor: c.foregroundColor, colorId: c.colorId,
      accessRole: c.accessRole, timeZone: c.timeZone || 'UTC', primary: Boolean(c.primary),
    }));
  }

  async listEvents(calendars: Calendar[], range: DateRange, signal: AbortSignal): Promise<CalendarEvent[]> {
    const bounds = rangeBounds(range);
    const events: CalendarEvent[] = [];
    // Sequential calendars avoid a burst of requests and simplify cancellation/error handling.
    for (const calendar of calendars) {
      if (!canReadEvents(calendar)) continue;
      const rows = await this.pages<GoogleEvent>(`calendars/${encodeURIComponent(calendar.id)}/events`, {
        ...bounds, singleEvents: 'true', orderBy: 'startTime', showDeleted: 'false', maxResults: '2500',
      }, signal);
      for (const row of rows) {
        const event = normalizeEvent(row, calendar);
        if (event) events.push(event);
      }
    }
    return sortEvents(events);
  }
}
