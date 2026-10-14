// Disposable visual fixture, excluded from the production entry. No Google calls.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Planner from '../src/Planner.tsx';
import { CATEGORIES, CALENDAR_CATEGORIES } from '../src/categories.ts';
import { addDays, addMonths, filterCalendars, initialHorizon } from '../src/planner-layout.ts';
import type { Calendar, CalendarEvent } from '../src/types.ts';
import '../src/styles.css';

const calendars: Calendar[] = Object.keys(CATEGORIES).map((name, index) => ({
  id: `demo-${index}`, name: `Sample ${name}`, color: ['#4285f4', '#0b8043', '#8e24aa', '#e67c73'][index % 4],
  primary: index === 0, accessRole: 'reader', timeZone: 'Europe/London',
}));
Object.assign(CALENDAR_CATEGORIES, Object.fromEntries(calendars.map((calendar, i) => [calendar.id, Object.keys(CATEGORIES)[i]])));
const events: CalendarEvent[] = [];
function event(id: string, title: string, start: string, end: string, calendar: Calendar): CalendarEvent {
  return { id, title, calendarId: calendar.id, calendarName: calendar.name, calendarTimeZone: calendar.timeZone,
    start: { kind: 'date', date: start }, end: { kind: 'date', date: end }, allDay: true, endTimeUnspecified: false,
    description: 'Representative sample event for layout validation. No live calendar data.' };
}
const titles = ['Public holiday (sample)', 'Friends & family', 'Time away', 'Club tournament', 'Wedding weekend', 'Project handover', 'Garden jobs', 'Appointments'];
for (let monthIndex = 0; monthIndex < 6; monthIndex++) {
  const month = addMonths('2026-10-01', monthIndex);
  const count = [6, 7, 6, 8, 5, 7][monthIndex];
  for (let track = 0; track < count; track++) {
    const start = addDays(month, track === 0 ? 9 : 5 + track % 4);
    const end = addDays(month, track === 0 ? 10 : 12 + track * 2);
    events.push(event(`${month}-${track}`, titles[track], start, end, calendars[track]));
  }
  events.push(event(`${month}-short`, 'Lunch', addDays(month, 27), addDays(month, 28), calendars[1]));
}
events.push(event('month-boundary', 'Long weekend away', '2026-09-28', '2026-10-04', calendars[2]));
events.push(event('year-boundary', 'New Year break', '2026-12-29', '2027-01-05', calendars[2]));
function LayoutPreview() {
  const [horizon, setHorizon] = useState(() => initialHorizon('2026-10-14'));
  const [selected, setSelected] = useState(calendars.map(calendar => calendar.id));
  return <main className="calendar-app"><Planner events={filterCalendars(events, selected)} calendars={calendars} horizon={horizon}
    onHorizonChange={setHorizon} timeZone="Europe/London" status={<span>Sample data</span>}
    controls={<><details className="calendar-controls"><summary>Calendars ({selected.length})</summary><div className="calendar-popover"><ul className="calendars">
      {calendars.map(calendar => <li key={calendar.id}><label><input type="checkbox" checked={selected.includes(calendar.id)} onChange={e =>
        setSelected(previous => e.target.checked ? [...previous, calendar.id] : previous.filter(id => id !== calendar.id))} />{calendar.name}</label></li>)}
    </ul></div></details><button disabled>Refresh</button><button disabled>Sign out</button></>} /></main>;
}
createRoot(document.getElementById('root')!).render(<LayoutPreview />);
