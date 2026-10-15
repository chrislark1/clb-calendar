import { useEffect, useRef, useState } from 'react';
import { GoogleAuth, loadGoogle } from './auth.ts';
import { CalendarApi, CalendarApiError, canReadEvents } from './calendar-api.ts';
import Planner from './Planner.tsx';
import { PlannerEvents } from './planner-events.ts';
import { addDays, eventDates, filterCalendars, initialHorizon, navigationHorizon, queryHorizon } from './planner-layout.ts';
import type { Calendar, CalendarEvent } from './types.ts';
import EventEditor from './EventEditor.tsx';
import { canWriteCalendar, editingReason } from './editor-model.ts';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please retry.';
}

export default function App({ clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID }: { clientId?: string } = {}) {
  const [authorized, setAuthorized] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [oauth, setOAuth] = useState<Awaited<ReturnType<typeof loadGoogle>>>();
  const [sdkAttempt, setSdkAttempt] = useState(0);
  const auth = useRef<GoogleAuth | null>(null);
  if (!auth.current) auth.current = new GoogleAuth(clientId || '', () => {
    setAuthorized(false);
    setError('Your session expired. Sign in again.');
  });
  const currentAuth = auth.current;
  const attempt = useRef(0);

  useEffect(() => {
    let active = true;
    if (clientId && !clientId.startsWith('your-')) {
      loadGoogle().then(value => { if (active) { setOAuth(value); setError(''); } })
        .catch(reason => { if (active) setError(message(reason)); });
    }
    return () => { active = false; };
  }, [clientId, sdkAttempt]);
  useEffect(() => () => { attempt.current++; currentAuth.clear(); }, [currentAuth]);

  function signOut(reason = '') {
    attempt.current++;
    currentAuth.clear();
    setAuthorized(false);
    setPending(false);
    setError(reason);
  }

  async function signIn() {
    if (!clientId || clientId.startsWith('your-')) {
      setError('Configure VITE_GOOGLE_CLIENT_ID in .env.local, then restart the development server.');
      return;
    }
    if (!oauth) { setError('Loading Google authorisation. Please try again in a moment.'); setSdkAttempt(value => value + 1); return; }
    const id = ++attempt.current;
    setError('');
    setPending(true);
    try {
      await currentAuth.authorize(oauth);
      if (id === attempt.current) setAuthorized(true);
    } catch (reason) { if (id === attempt.current) setError(message(reason)); }
    finally { if (id === attempt.current) setPending(false); }
  }

  if (!authorized) return <main className="login">
    <h1>CLB Calendar</h1>
    <button onClick={signIn} disabled={pending}>{pending ? 'Signing in…' : 'Sign in with Google'}</button>
    {error && <p role="alert">{error}</p>}
  </main>;

  return <CalendarView auth={currentAuth} signOut={signOut} />;
}

function CalendarView({ auth, signOut }: { auth: GoogleAuth; signOut: (reason?: string) => void }) {
  const [api] = useState(() => new CalendarApi(() => auth.getToken()));
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [horizon, setHorizon] = useState(initialHorizon);
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [eventCache] = useState(() => new PlannerEvents());
  const [refresh, setRefresh] = useState(0);
  const [discovering, setDiscovering] = useState(true);
  const [retrieving, setRetrieving] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [eventError, setEventError] = useState('');
  const [retrieved, setRetrieved] = useState(false);
  const [editor, setEditor] = useState<{ original?: CalendarEvent; startDate?: string } | null>(null);
  const [reloadEvents, setReloadEvents] = useState(0);
  // Keep signOut out of request dependencies while retaining its latest callback.
  const exit = useRef(signOut);
  exit.current = signOut;

  function handleError(reason: unknown, setter: (value: string) => void) {
    if (reason instanceof CalendarApiError && reason.status === 401) exit.current(reason.message);
    else setter(message(reason));
  }

  useEffect(() => {
    const controller = new AbortController();
    setDiscovering(true);
    setDiscoveryError('');
    eventCache.clear();
    setEvents([]);
    setRetrieved(false);
    api.listCalendars(controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setRetrieving(true);
      setCalendars(rows);
      setSelected(previous => previous === null
        ? rows.filter(c => c.primary && canReadEvents(c)).map(c => c.id)
        : previous.filter(id => rows.some(c => c.id === id && canReadEvents(c))));
    }).catch(reason => {
      if (!controller.signal.aborted) handleError(reason, setDiscoveryError);
    }).finally(() => { if (!controller.signal.aborted) setDiscovering(false); });
    return () => controller.abort();
  }, [api, refresh, eventCache]);

  useEffect(() => {
    const controller = new AbortController();
    setRetrieved(false);
    setEventError('');
    setRetrieving(false);
    if (discovering || discoveryError || selected === null) return () => controller.abort();
    setRetrieving(true);
    eventCache.retain(queryHorizon(horizon));
    eventCache.load(api, calendars.filter(c => selected.includes(c.id) && canReadEvents(c)), queryHorizon(horizon), controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setEvents(rows);
      setRetrieved(true);
    }).catch(reason => {
      if (!controller.signal.aborted) {
        eventCache.clear();
        setEvents([]);
        handleError(reason, setEventError);
      }
    }).finally(() => { if (!controller.signal.aborted) setRetrieving(false); });
    return () => controller.abort();
  }, [api, calendars, selected, horizon, discovering, discoveryError, eventCache, reloadEvents]);

  function afterMutation(calendarId: string, saved?: CalendarEvent) {
    setRetrieving(true);
    setRetrieved(false);
    eventCache.invalidate(calendarId);
    setEvents(previous => previous.filter(event => event.calendarId !== calendarId));
    setSelected(previous => [...new Set([...(previous ?? []), calendarId])]);
    if (saved) {
      const dates = eventDates(saved, timeZone);
      setHorizon(previous => {
        const startRange = navigationHorizon(previous, dates.start);
        const wholeEvent = navigationHorizon(startRange, addDays(dates.end, -1));
        return wholeEvent.start <= dates.start && wholeEvent.end > dates.start ? wholeEvent : startRange;
      });
    }
    setReloadEvents(value => value + 1);
    setEditor(null);
  }

  const busy = discovering || retrieving;
  const visibleEvents = filterCalendars(events, selected ?? []).filter(event => {
    const dates = eventDates(event, timeZone);
    return dates.start < horizon.end && dates.end > horizon.start;
  });
  return <main className="calendar-app">
    <Planner events={visibleEvents} calendars={calendars} horizon={horizon} onHorizonChange={setHorizon} timeZone={timeZone} loading={busy}
      onCreate={calendars.some(canWriteCalendar) ? date => setEditor({ startDate: date }) : undefined} onEdit={event => {
      if (!editingReason(event, calendars.find(c => c.id === event.calendarId))) setEditor({ original: event });
    }} onDelete={async (event, signal) => {
      const calendar = calendars.find(c => c.id === event.calendarId);
      const reason = editingReason(event, calendar);
      if (!calendar || reason) throw new Error(reason || 'This calendar is unavailable.');
      try {
        await api.deleteEvent(calendar, event, signal);
        if (!signal.aborted) afterMutation(calendar.id);
      } catch (error) {
        if (error instanceof CalendarApiError && error.status === 401) exit.current(error.message);
        throw error;
      }
    }} controls={<>
    <details className="calendar-controls" open={selected === null || undefined}>
      <summary>Calendars ({selected?.length ?? 0})</summary>
      <div className="calendar-popover">
      {discovering ? <p role="status">Loading calendars…</p> : calendars.length === 0 && !discoveryError ? <p>No calendars found.</p> : null}
      <ul className="calendars">{calendars.map(calendar => <li key={calendar.id}>
        <label><input type="checkbox" checked={selected?.includes(calendar.id) ?? false}
          disabled={!canReadEvents(calendar) || discovering}
          onChange={event => setSelected(previous => event.target.checked
            ? [...(previous ?? []), calendar.id] : (previous ?? []).filter(id => id !== calendar.id))} />
          <span className="swatch" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(calendar.color ?? '') ? calendar.color : '#777777' }} aria-hidden="true" />
          <span>{calendar.name}{calendar.primary ? ' (primary)' : ''}
            <small>{calendar.accessRole} · {calendar.timeZone}{!canReadEvents(calendar) ? ' · Event details unavailable' : ''}</small>
            {calendar.description && <small>{calendar.description}</small>}
          </span></label>
      </li>)}</ul>
      </div>
    </details>
      <button disabled={busy || !calendars.some(canWriteCalendar)} onClick={() => setEditor({})}>New event</button>
      <button data-action="refresh" onClick={() => setRefresh(value => value + 1)} disabled={busy}>Refresh</button>
      <button onClick={() => signOut()}>Sign out</button>
    </>} status={<>
      {discoveryError && <p role="alert">{discoveryError}</p>}
      {eventError && <p role="alert">{eventError}</p>}
      {busy && <p role="status">Retrieving…</p>}
      {!busy && retrieved && visibleEvents.length === 0 && <p>{selected?.length ? 'No events in this horizon.' : 'Select a calendar to retrieve events.'}</p>}
    </>} />
    {editor && <EventEditor api={api} calendars={calendars} original={editor.original} startDate={editor.startDate}
      onClose={() => setEditor(null)} onExpired={reason => signOut(reason)} onSaved={afterMutation} />}
  </main>;
}
