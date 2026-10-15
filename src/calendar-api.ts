import type { Calendar, CalendarEvent, DateRange, EventTime } from './types.ts';
import { rangeBounds, sortEvents } from './dates.ts';
import { bodyForDraft, canWriteCalendar, editingReason } from './editor-model.ts';
import type { EventDraft } from './editor-model.ts';
import { CATEGORY_PROPERTY } from './categories.ts';

interface GoogleTime { date?: string; dateTime?: string; timeZone?: string }
interface GoogleEvent {
  id: string; summary?: string; description?: string; location?: string;
  start?: GoogleTime; end?: GoogleTime; originalStartTime?: GoogleTime;
  recurringEventId?: string; iCalUID?: string; status?: string; visibility?: string;
  eventType?: string; updated?: string; endTimeUnspecified?: boolean;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  etag?: string; recurrence?: string[]; locked?: boolean; guestsCanModify?: boolean;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
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
      : status === 412 ? 'This event changed in Google Calendar. Close the editor, refresh, and reopen it before editing.'
      : status === 404 || status === 410 ? 'This event is no longer available. Close the editor and refresh.'
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
    organizer: event.organizer ? { email: event.organizer.email, name: event.organizer.displayName, self: event.organizer.self ?? false } : undefined,
    etag: event.etag, recurring: Boolean(event.recurrence?.length || event.recurringEventId || event.originalStartTime),
    locked: event.locked, guestsCanModify: event.guestsCanModify,
    privateProperties: event.extendedProperties?.private, sharedProperties: event.extendedProperties?.shared,
  };
}

export class CalendarApi {
  private getToken: () => string;
  private fetcher: typeof fetch;
  private pending = new Set<string>();
  // Native browser fetch must retain Window as its receiver when stored on this instance.
  constructor(getToken: () => string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.getToken = getToken;
    this.fetcher = fetcher;
  }

  private async request(path: string, method: string, signal: AbortSignal, body?: unknown, etag?: string): Promise<GoogleEvent | undefined> {
    signal.throwIfAborted();
    const headers: Record<string, string> = { Authorization: `Bearer ${this.getToken()}` };
    if (body) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-Match'] = etag;
    const response = await this.fetcher(`https://www.googleapis.com/calendar/v3/${path}`, {
      method, headers, signal, cache: 'no-store', credentials: 'omit', ...(body ? { body: JSON.stringify(body) } : {}),
    });
    signal.throwIfAborted();
    if (!response.ok) throw new CalendarApiError(response.status);
    return response.status === 204 ? undefined : await response.json() as GoogleEvent;
  }

  private async mutation<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.pending.has(key)) throw new Error('A change is already in progress.');
    this.pending.add(key);
    try { return await work(); } finally { this.pending.delete(key); }
  }
  private assertWritable(calendar: Calendar): void {
    if (!canWriteCalendar(calendar)) throw new Error('This calendar is read-only.');
  }
  private path(calendar: Calendar, id?: string): string {
    return `calendars/${encodeURIComponent(calendar.id)}/events${id ? `/${encodeURIComponent(id)}` : ''}`;
  }
  private async latest(calendar: Calendar, expected: CalendarEvent, signal: AbortSignal): Promise<CalendarEvent> {
    this.assertWritable(calendar);
    if (calendar.id !== expected.calendarId) throw new Error('Existing events must stay on their original calendar.');
    const reason = editingReason(expected, calendar);
    if (reason) throw new Error(reason);
    const raw = await this.request(this.path(calendar, expected.id), 'GET', signal);
    const current = raw && normalizeEvent(raw, calendar);
    if (!current) throw new CalendarApiError(410);
    const currentReason = editingReason(current, calendar);
    if (currentReason) throw new Error(currentReason);
    if (!current.etag) throw new Error('Google did not return an event version. Close the editor and refresh before retrying.');
    if (expected.etag && expected.etag !== current.etag) throw new CalendarApiError(412);
    return current;
  }
  async createEvent(calendar: Calendar, draft: EventDraft, signal: AbortSignal): Promise<CalendarEvent> {
    this.assertWritable(calendar);
    if (calendar.id !== draft.calendarId) throw new Error('Choose the event calendar.');
    if (!/^[0-9a-v]{5,1024}$/.test(draft.id)) throw new Error('Invalid new-event identifier. Reopen the editor.');
    const body = { ...bodyForDraft(draft), id: draft.id };
    return this.mutation(JSON.stringify([calendar.id, draft.id]), async () => {
      let raw: GoogleEvent | undefined;
      try { raw = await this.request(this.path(calendar), 'POST', signal, body); }
      catch (error) {
        // Stable client-generated IDs make retry after an uncertain create safe.
        if (!(error instanceof CalendarApiError) || error.status !== 409) throw error;
        raw = await this.request(this.path(calendar, draft.id), 'GET', signal);
        const sameTime = (a?: GoogleTime, b?: { date?: string | null; dateTime?: string | null }) =>
          Boolean(a && b && (a.date ? a.date === b.date : a.dateTime && b.dateTime && Date.parse(a.dateTime) === Date.parse(b.dateTime)));
        if (!raw || raw.summary !== body.summary || (raw.description ?? '') !== body.description || !sameTime(raw.start, body.start)
          || !sameTime(raw.end, body.end) || raw.extendedProperties?.shared?.[CATEGORY_PROPERTY] !== draft.category) {
          throw new Error('This create may already have succeeded with different values. Close the editor and refresh before editing the existing event.');
        }
      }
      const event = raw && normalizeEvent(raw, calendar);
      if (!event) throw new Error('Google did not return the saved event. Close the editor and refresh before retrying.');
      return event;
    });
  }
  async updateEvent(calendar: Calendar, event: CalendarEvent, draft: EventDraft, signal: AbortSignal): Promise<CalendarEvent> {
    return this.mutation(JSON.stringify([calendar.id, event.id]), async () => {
      const current = await this.latest(calendar, event, signal);
      const body = bodyForDraft(draft, event);
      // Preserve current extended properties from a fresh GET, not a stale editor snapshot.
      body.extendedProperties = { ...(current.privateProperties ? { private: { ...current.privateProperties } } : {}),
        shared: { ...current.sharedProperties, [CATEGORY_PROPERTY]: draft.category } };
      const raw = await this.request(this.path(calendar, event.id), 'PATCH', signal, body, current.etag);
      const saved = raw && normalizeEvent(raw, calendar);
      if (!saved) throw new Error('Google did not return the saved event. Close the editor and refresh.');
      return saved;
    });
  }
  async deleteEvent(calendar: Calendar, event: CalendarEvent, signal: AbortSignal): Promise<void> {
    return this.mutation(JSON.stringify([calendar.id, event.id]), async () => {
      const current = await this.latest(calendar, event, signal);
      await this.request(this.path(calendar, event.id), 'DELETE', signal, undefined, current.etag);
    });
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
