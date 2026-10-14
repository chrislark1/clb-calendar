import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Calendar, CalendarEvent, DateRange } from './types.ts';
import { formatTime } from './dates.ts';
import { CATEGORIES, categoryFor, calendarColor } from './categories.ts';
import { DAY_COLUMNS, MIN_DAY_WIDTH, MONTH_LABEL_WIDTH, addDays, addMonths, dateInZone, eventKey, layoutMonth, monthsIn, monthStart } from './planner-layout.ts';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TRACK_HEIGHT = 25;
const HEADER_HEIGHT = 20;
function monthName(month: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T00:00:00Z`));
}

export default function Planner({ events, calendars, horizon, onHorizonChange, timeZone, controls, status }: {
  events: CalendarEvent[]; calendars: Calendar[]; horizon: DateRange;
  onHorizonChange: (range: DateRange) => void; timeZone: string;
  controls?: ReactNode; status?: ReactNode;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const weekdayTrack = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const today = dateInZone(Date.now(), timeZone);
  const layouts = useMemo(() => monthsIn(horizon).map(month => layoutMonth(month, events, timeZone)), [horizon, events, timeZone]);
  const details = events.find(event => eventKey(event) === opened);
  const colors = new Map(calendars.map(calendar => [calendar.id, calendarColor(calendar.color)]));

  useEffect(() => {
    const panel = dialog.current;
    if (details && panel && !panel.open) panel.showModal();
    if (!details) { panel?.close(); setOpened(null); }
  }, [details]);
  useEffect(() => {
    if (!target || !viewport.current) return;
    const row = [...viewport.current.querySelectorAll<HTMLElement>('[data-month]')].find(element => element.dataset.month === monthStart(target));
    if (!row) return;
    const day = row.querySelector<HTMLElement>(`[data-date="${target}"]`);
    const container = viewport.current;
    window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().top - (top.current?.getBoundingClientRect().height ?? 80) - 2 });
    container.scrollTo({ left: day ? Math.max(0, day.offsetLeft + MONTH_LABEL_WIDTH - container.clientWidth / 2) : 0 });
    setTarget(null);
  }, [target, horizon]);

  function navigate(date: string, range: DateRange) {
    onHorizonChange(range);
    setTarget(date);
  }
  function closeDetails() { setOpened(null); }

  return <section className="planner" aria-label="Rolling planner" style={{ '--month-width': `${MONTH_LABEL_WIDTH}px`, '--min-sheet-width': `${MONTH_LABEL_WIDTH + DAY_COLUMNS * MIN_DAY_WIDTH}px` } as CSSProperties}>
    <div ref={top} className="planner-top">
    <header className="planner-toolbar">
      <nav className="toolbar-start" aria-label="Planner navigation">
        <h1>CLB Calendar</h1>
        <button onClick={() => navigate(today, {
          start: today < horizon.start ? monthStart(today) : horizon.start,
          end: today >= horizon.end ? addMonths(today, 1) : horizon.end,
        })}>Today</button>
        <button aria-label="Previous month" title="Previous month" onClick={() => { const start = addMonths(horizon.start, -1); navigate(start, { ...horizon, start }); }}>‹</button>
        <button aria-label="Next month" title="Next month" onClick={() => navigate(horizon.end, { ...horizon, end: addMonths(horizon.end, 1) })}>›</button>
      </nav>
      <div className="toolbar-end">{controls}</div>
    </header>
    <div className="planner-caption"><span>{monthName(horizon.start)} – {monthName(addMonths(horizon.end, -1))} · {timeZone}</span>{status}</div>
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
            <div className="day-columns" aria-hidden="true">{Array.from({ length: DAY_COLUMNS }, (_, column) => {
              const number = column - layout.offset + 1;
              const active = number > 0 && number <= layout.days;
              const date = active ? addDays(layout.month, number - 1) : undefined;
              return <div key={column} data-date={date} className={`day-column${column % 7 >= 5 ? ' weekend' : ''}${!active ? ' outside-month' : ''}${date === today ? ' today' : ''}`}>
                <span>{active ? number : ''}</span>
              </div>;
            })}</div>
            {layout.segments.map(segment => {
              const category = categoryFor(segment.event);
              const palette = CATEGORIES[category];
              return <button key={eventKey(segment.event)} className={`event-bar${segment.span >= 4 ? ' wide-event' : ''}${segment.continuesBefore ? ' continues-before' : ''}${segment.continuesAfter ? ' continues-after' : ''}`}
                data-event={eventKey(segment.event)} data-start={segment.start} data-end={segment.end} data-track={segment.track}
                style={{ left: `calc(${segment.column / DAY_COLUMNS * 100}% + 1px)`, width: `calc(${segment.span / DAY_COLUMNS * 100}% - 2px)`,
                  top: HEADER_HEIGHT + segment.track * TRACK_HEIGHT, background: palette.color, color: palette.text,
                  borderLeftColor: colors.get(segment.event.calendarId) }}
                title={`${segment.event.title}\n${segment.event.calendarName} · ${category}\n${formatTime(segment.event.start)} → ${formatTime(segment.event.end)}`}
                aria-label={`${segment.event.title}, ${segment.event.calendarName}, ${category}, ${segment.start} to ${segment.end} exclusive`}
                onClick={() => setOpened(eventKey(segment.event))}>{segment.event.title}</button>;
            })}
          </div>
        </div>)}
      </div>
    </div>
    <dialog ref={dialog} className="event-details" aria-labelledby="event-title" onCancel={() => setOpened(null)} onClose={() => { if (!dialog.current?.open) setOpened(null); }} onClick={event => { if (event.target === event.currentTarget) closeDetails(); }}>
      {details && <div className="details-content">
        <header><h2 id="event-title">{details.title}</h2><button onClick={closeDetails} autoFocus aria-label="Close event details">Close</button></header>
        <dl>
          <dt>Calendar</dt><dd><i className="swatch" style={{ background: colors.get(details.calendarId) }} />{details.calendarName}</dd>
          <dt>Category</dt><dd>{categoryFor(details)}</dd>
          <dt>Start</dt><dd>{formatTime(details.start)}</dd>
          <dt>End</dt><dd>{details.endTimeUnspecified ? 'Unspecified' : formatTime(details.end)}{details.allDay ? ' (exclusive)' : ''}</dd>
          <dt>Type</dt><dd>{details.allDay ? 'All-day' : 'Timed'}</dd>
          {!details.allDay && <><dt>Planner time zone</dt><dd>{timeZone}</dd></>}
        </dl>
        {details.description && <p className="event-description">{details.description}</p>}
      </div>}
    </dialog>
  </section>;
}
