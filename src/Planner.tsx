import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Calendar, CalendarEvent, DateRange } from './types.ts';
import { formatTime } from './dates.ts';
import { CATEGORIES, categoryFor, calendarColor } from './categories.ts';
import { editingReason } from './editor-model.ts';
import DeleteConfirmation from './DeleteConfirmation.tsx';
import { DAY_COLUMNS, MIN_DAY_WIDTH, MONTH_LABEL_WIDTH, addDays, addMonths, dateInZone, eventKey, layoutMonth, monthsIn, monthStart, navigationHorizon } from './planner-layout.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TRACK_HEIGHT = 25;
const HEADER_HEIGHT = 20;
const LABEL_MIN_FONT_SIZE = 7;
const LABEL_MAX_FONT_SIZE = 11;
const LABEL_WIDTH_FACTOR = 240;
function eventLabelFontSize(span: number, title: string): number {
  return Math.max(LABEL_MIN_FONT_SIZE, Math.min(LABEL_MAX_FONT_SIZE, LABEL_WIDTH_FACTOR * span / Math.max(title.length, 1)));
}
function monthName(month: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`));
}

export default function Planner({ events, calendars, horizon, onHorizonChange, timeZone, controls, status, onEdit, onDelete, onCreate, loading = false }: {
  events: CalendarEvent[]; calendars: Calendar[]; horizon: DateRange;
  onHorizonChange: (range: DateRange) => void; timeZone: string;
  controls?: ReactNode; status?: ReactNode;
  onEdit?: (event: CalendarEvent) => void;
  onDelete?: (event: CalendarEvent, signal: AbortSignal) => Promise<void>;
  onCreate?: (date: string) => void;
  loading?: boolean;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmationWidth, setConfirmationWidth] = useState<number>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteRequest = useRef<AbortController | null>(null);
  const [target, setTarget] = useState<{ date: string; centreDay: boolean } | null>(null);
  const [currentMonth, setCurrentMonth] = useState(horizon.start);
  const [focusedDate, setFocusedDate] = useState(() => dateInZone(Date.now(), timeZone));
  const viewport = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const weekdayTrack = useRef<HTMLDivElement>(null);
  const navigating = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const today = dateInZone(Date.now(), timeZone);
  const layouts = useMemo(() => monthsIn(horizon).map(month => layoutMonth(month, events, timeZone)), [horizon, events, timeZone]);
  const details = events.find(event => eventKey(event) === opened);
  const readOnlyReason = details ? editingReason(details, calendars.find(c => c.id === details.calendarId)) : '';
  const colors = new Map(calendars.map(calendar => [calendar.id, calendarColor(calendar.color)]));

  useEffect(() => {
    const panel = dialog.current;
    if (details && panel && !panel.open) panel.showModal();
    if (!details) { panel?.close(); setOpened(null); }
  }, [details]);
  useEffect(() => () => deleteRequest.current?.abort(), []);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (navigating.current) return;
        const edge = (top.current?.getBoundingClientRect().bottom ?? 0) + 3;
        const rows = [...(viewport.current?.querySelectorAll<HTMLElement>('[data-month]') ?? [])];
        const row = rows.find(row => row.getBoundingClientRect().bottom > edge) ?? rows.at(-1);
        if (row?.dataset.month) setCurrentMonth(row.dataset.month);
      });
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [layouts]);
  useEffect(() => {
    if (!target || !viewport.current || loading) return;
    const row = [...viewport.current.querySelectorAll<HTMLElement>('[data-month]')].find(element => element.dataset.month === monthStart(target.date));
    if (!row) return;
    const container = viewport.current;
    const frame = requestAnimationFrame(() => {
      navigating.current = true;
      window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().top - (top.current?.getBoundingClientRect().height ?? 80) - 2 });
      if (target.centreDay) {
        const day = row.querySelector<HTMLElement>(`[data-date="${target.date}"]`);
        if (day) container.scrollTo({ left: Math.max(0, day.offsetLeft + MONTH_LABEL_WIDTH - container.clientWidth / 2) });
      }
      setCurrentMonth(monthStart(target.date));
      setTarget(null);
      requestAnimationFrame(() => { navigating.current = false; });
    });
    return () => cancelAnimationFrame(frame);
  }, [target, horizon, loading, layouts]);

  function navigate(date: string, centreDay = false) {
    const range = navigationHorizon(horizon, date);
    if (range.start !== horizon.start || range.end !== horizon.end) onHorizonChange(range);
    setTarget({ date, centreDay });
  }
  function closeDetails() {
    if (deleteRequest.current) return;
    setOpened(null); setConfirmDelete(false); setDeleteError('');
  }
  async function deleteDetails() {
    if (!details || !onDelete || readOnlyReason || !confirmDelete || deleteRequest.current) return;
    const controller = new AbortController();
    deleteRequest.current = controller;
    setDeleting(true); setDeleteError('');
    try { await onDelete(details, controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) setDeleteError(error instanceof TypeError
        ? 'Deletion could not be confirmed. Close and refresh before retrying.'
        : error instanceof Error ? error.message : 'The event could not be deleted. Please retry.');
    } finally {
      deleteRequest.current = null;
      if (!controller.signal.aborted) setDeleting(false);
    }
  }

  return <section className="planner" aria-label="Rolling planner" style={{ '--month-width': `${MONTH_LABEL_WIDTH}px`, '--min-sheet-width': `${MONTH_LABEL_WIDTH + DAY_COLUMNS * MIN_DAY_WIDTH}px` } as CSSProperties}>
    <div ref={top} className="planner-top">
    <header className="planner-toolbar">
      <nav className="toolbar-start" aria-label="Planner navigation">
        <h1>CLB Calendar</h1>
        <button onClick={() => navigate(today, true)}>Today</button>
        <button aria-label="Previous month" title="Previous month" disabled={currentMonth <= '1900-01-01'} onClick={() => navigate(addMonths(currentMonth, -1))}>‹</button>
        <button aria-label="Next month" title="Next month" disabled={currentMonth >= '2199-12-01'} onClick={() => navigate(addMonths(currentMonth, 1))}>›</button>
        <input className="month-picker" type="month" aria-label="Jump to month" min="1900-01" max="2199-12" value={currentMonth.slice(0, 7)} onChange={event => {
          if (/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) navigate(`${event.target.value}-01`);
        }} />
      </nav>
      <div className="toolbar-end">{controls}</div>
    </header>
    <div className="planner-caption"><span>{monthName(horizon.start)} – {monthName(addMonths(horizon.end, -1))} · {timeZone}</span>{status}
      {!onCreate && <span>No writable calendars available. Event creation is disabled.</span>}
    </div>
    <div className="weekday-heading"><div className="month-heading" aria-label="Month">{horizon.start.slice(0, 4)}</div><div className="weekday-clip"><div ref={weekdayTrack} className="weekday-columns">
          {Array.from({ length: DAY_COLUMNS }, (_, column) => <span key={column} className={column % 7 >= 5 ? 'weekend' : ''}>{WEEKDAYS[column % 7]}</span>)}
    </div></div></div>
    </div>
    <div ref={viewport} className="planner-viewport" tabIndex={0} aria-label="Scrollable months and days" onScroll={event => {
      if (weekdayTrack.current) weekdayTrack.current.style.transform = `translateX(-${event.currentTarget.scrollLeft}px)`;
    }}>
      <div className="planner-sheet">
        {layouts.map(layout => <div key={layout.month} className="month-row" data-month={layout.month}>
          <h2 className="month-label" aria-label={monthName(layout.month)} title={monthName(layout.month)}>
            {new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${layout.month}T00:00:00Z`)).slice(0, 3).toUpperCase()}
            {(layout.month.endsWith('-01-01') || layout.month === horizon.start) && <small>{layout.month.slice(0, 4)}</small>}
          </h2>
          <div className="month-grid" style={{ height: `${layout.tracks ? HEADER_HEIGHT + layout.tracks * TRACK_HEIGHT + 2 : 38}px` }}>
            <div className="day-columns">{Array.from({ length: DAY_COLUMNS }, (_, column) => {
              const number = column - layout.offset + 1;
              const active = number > 0 && number <= layout.days;
              const date = active ? addDays(layout.month, number - 1) : undefined;
              return <div key={column} data-date={date} className={`day-column${column % 7 >= 5 ? ' weekend' : ''}${!active ? ' outside-month' : ''}${date === today ? ' today' : ''}`}>
                {date ? <button className="date-hit" aria-label={`Create event on ${date}`} title={onCreate ? `New event on ${date}` : 'No writable calendars available'} disabled={!onCreate}
                  tabIndex={date === focusedDate || (focusedDate < horizon.start || focusedDate >= horizon.end) && date === horizon.start ? 0 : -1}
                  onFocus={() => setFocusedDate(date)} onClick={() => onCreate?.(date)} onKeyDown={event => {
                    const offset = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
                    if (!offset) return;
                    const next = addDays(date, offset);
                    const button = viewport.current?.querySelector<HTMLButtonElement>(`[data-date="${next}"] .date-hit`);
                    if (button) { event.preventDefault(); button.focus(); }
                  }}><span>{number}</span></button> : <span aria-hidden="true" />}
              </div>;
            })}</div>
            {layout.segments.map(segment => {
              const category = categoryFor(segment.event);
              const palette = CATEGORIES[category];
              return <button key={eventKey(segment.event)} className={`event-bar${segment.span >= 4 ? ' wide-event' : ''}${segment.continuesBefore ? ' continues-before' : ''}${segment.continuesAfter ? ' continues-after' : ''}`}
                data-event={eventKey(segment.event)} data-start={segment.start} data-end={segment.end} data-track={segment.track}
                style={{ left: `calc(${segment.column / DAY_COLUMNS * 100}% + 1px)`, width: `calc(${segment.span / DAY_COLUMNS * 100}% - 2px)`,
                  top: HEADER_HEIGHT + segment.track * TRACK_HEIGHT, background: palette.color, color: palette.text,
                  borderLeftColor: colors.get(segment.event.calendarId), fontSize: `${eventLabelFontSize(segment.span, segment.event.title)}px` }}
                title={`${segment.event.title}\n${segment.event.calendarName} · ${category}\n${formatTime(segment.event.start)} → ${formatTime(segment.event.end)}`}
                aria-label={`${segment.event.title}, ${segment.event.calendarName}, ${category}, ${segment.start} to ${segment.end} exclusive`}
                onClick={() => { setConfirmDelete(false); setDeleteError(''); setOpened(eventKey(segment.event)); }}><span className="event-label">{segment.event.title}</span></button>;
            })}
          </div>
        </div>)}
      </div>
    </div>
    <dialog ref={dialog} className="event-details" style={confirmDelete && confirmationWidth ? { width: confirmationWidth } : undefined} aria-labelledby="event-title" onCancel={event => {
      if (deleteRequest.current) event.preventDefault(); else closeDetails();
    }} onClose={() => { if (!dialog.current?.open) closeDetails(); }} onClick={event => { if (event.target === event.currentTarget) closeDetails(); }}>
      {details && <div className="details-content">
        <header><h2 id="event-title">{details.title}</h2><button disabled={deleting} onClick={closeDetails} autoFocus aria-label="Close event details">Close</button></header>
        <dl>
          <dt>Calendar</dt><dd><i className="swatch" style={{ background: colors.get(details.calendarId) }} />{details.calendarName}</dd>
          <dt>Category</dt><dd>{categoryFor(details)}</dd>
          <dt>Start</dt><dd>{formatTime(details.start)}</dd>
          <dt>End</dt><dd>{details.endTimeUnspecified ? 'Unspecified' : formatTime(details.end)}{details.allDay ? ' (exclusive)' : ''}</dd>
          <dt>Type</dt><dd>{details.allDay ? 'All-day' : 'Timed'}</dd>
          {!details.allDay && <><dt>Planner time zone</dt><dd>{timeZone}</dd></>}
        </dl>
        {details.description && <p className="event-description">{details.description}</p>}
        {readOnlyReason && <p className="editor-hint">{readOnlyReason}</p>}
        {deleteError && <p role="alert">{deleteError}</p>}
        {onEdit && !readOnlyReason && (confirmDelete && onDelete ? <DeleteConfirmation title={details.title} calendarName={details.calendarName} pending={deleting}
          onConfirm={() => void deleteDetails()} onCancel={() => { setConfirmDelete(false); setDeleteError(''); }} /> : <div className="details-actions">
          <button onClick={() => { closeDetails(); onEdit(details); }}>Edit</button>
          {onDelete && <button className="delete-event" onClick={() => {
            setConfirmationWidth(dialog.current?.getBoundingClientRect().width);
            setConfirmDelete(true);
          }}>Delete</button>}
        </div>)}
        {deleting && <p role="status">Deleting event from Google Calendar…</p>}
      </div>}
    </dialog>
  </section>;
}
