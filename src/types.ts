export interface Calendar {
  id: string;
  name: string;
  description?: string;
  color?: string;
  foregroundColor?: string;
  colorId?: string;
  accessRole: string;
  timeZone: string;
  primary: boolean;
}

// Dates stay as dates (never converted to UTC); timed values retain their offset.
// All ends are exclusive, matching Google's event semantics.
export type EventTime =
  | { kind: 'date'; date: string }
  | { kind: 'dateTime'; dateTime: string; timeZone?: string };

export interface CalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarTimeZone: string;
  title: string;
  description?: string;
  location?: string;
  start: EventTime;
  end: EventTime;
  allDay: boolean;
  endTimeUnspecified: boolean;
  recurringEventId?: string;
  originalStart?: EventTime;
  iCalUID?: string;
  status?: string;
  visibility?: string;
  eventType?: string;
  updated?: string;
  organizer?: { email?: string; name?: string; self?: boolean };
  etag?: string;
  recurring?: boolean;
  locked?: boolean;
  guestsCanModify?: boolean;
  privateProperties?: Record<string, string>;
  sharedProperties?: Record<string, string>;
}

export interface DateRange { start: string; end: string }
