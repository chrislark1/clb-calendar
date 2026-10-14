import { useEffect, useRef, useState } from 'react';
import { GoogleAuth, loadGoogle } from './auth.ts';
import { CalendarApi, CalendarApiError, canReadEvents } from './calendar-api.ts';
import { defaultRange, formatTime, rangeBounds } from './dates.ts';
import type { Calendar, CalendarEvent } from './types.ts';

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
  const [range, setRange] = useState(defaultRange);
  const [draftRange, setDraftRange] = useState(range);
  const [refresh, setRefresh] = useState(0);
  const [discovering, setDiscovering] = useState(true);
  const [retrieving, setRetrieving] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [eventError, setEventError] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [retrieved, setRetrieved] = useState(false);
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
    setEvents([]);
    setRetrieved(false);
    setDuration(null);
    api.listCalendars(controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setCalendars(rows);
      setSelected(previous => previous === null
        ? rows.filter(c => c.primary && canReadEvents(c)).map(c => c.id)
        : previous.filter(id => rows.some(c => c.id === id && canReadEvents(c))));
    }).catch(reason => {
      if (!controller.signal.aborted) handleError(reason, setDiscoveryError);
    }).finally(() => { if (!controller.signal.aborted) setDiscovering(false); });
    return () => controller.abort();
  }, [api, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setEvents([]);
    setDuration(null);
    setRetrieved(false);
    setEventError('');
    setRetrieving(false);
    if (discovering || discoveryError || selected === null) return () => controller.abort();
    const start = performance.now();
    setRetrieving(true);
    api.listEvents(calendars.filter(c => selected.includes(c.id)), range, controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setEvents(rows);
      setDuration(performance.now() - start);
      setRetrieved(true);
    }).catch(reason => {
      if (!controller.signal.aborted) handleError(reason, setEventError);
    }).finally(() => { if (!controller.signal.aborted) setRetrieving(false); });
    return () => controller.abort();
  }, [api, calendars, selected, range, discovering, discoveryError]);

  const busy = discovering || retrieving;
  return <main>
    <header><h1>CLB Calendar</h1><div className="actions">
      <button onClick={() => setRefresh(value => value + 1)} disabled={busy}>Refresh</button>
      <button onClick={() => signOut()}>Sign out</button>
    </div></header>
    <section aria-labelledby="calendars-heading">
      <h2 id="calendars-heading">Calendars</h2>
      {discoveryError && <p role="alert">{discoveryError}</p>}
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
    </section>
    <section aria-labelledby="range-heading">
      <h2 id="range-heading">Date range</h2>
      <form onSubmit={event => {
        event.preventDefault();
        try { rangeBounds(draftRange); setRange({ ...draftRange }); setRangeError(''); }
        catch (reason) { setRangeError(message(reason)); }
      }}>
        <label>Start <input type="date" required value={draftRange.start} onChange={e => setDraftRange({ ...draftRange, start: e.target.value })} /></label>
        <label>End (exclusive) <input type="date" required value={draftRange.end} onChange={e => setDraftRange({ ...draftRange, end: e.target.value })} /></label>
        <button type="submit" disabled={discovering}>Apply range</button>
      </form>
      {rangeError && <p role="alert">{rangeError}</p>}
    </section>
    <section aria-labelledby="events-heading" aria-busy={busy}>
      <h2 id="events-heading">Events</h2>
      <p>{selected?.length ?? 0} selected calendars · {events.length} events retrieved<br />
        {range.start} to {range.end} (exclusive) · Retrieval: {duration === null ? '—' : `${(duration / 1000).toFixed(2)} s`}</p>
      {eventError && <p role="alert">{eventError}</p>}
      {busy && <p role="status">Retrieving…</p>}
      {!busy && retrieved && events.length === 0 && <p>{selected?.length ? 'No events in this range.' : 'Select a calendar to retrieve events.'}</p>}
      <ol className="events">{events.map(event => <li key={`${event.calendarId}:${event.id}`}>
        <strong>{event.title}</strong>
        <div>{formatTime(event.start)} → {event.endTimeUnspecified ? 'End unspecified' : formatTime(event.end)}{event.allDay ? ' (end exclusive)' : ''}</div>
        <small>{event.calendarName} · {event.allDay ? 'All-day' : 'Timed'}</small>
      </li>)}</ol>
    </section>
  </main>;
}
