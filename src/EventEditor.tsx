import { useEffect, useRef, useState } from 'react';
import type { Calendar, CalendarEvent } from './types.ts';
import { CalendarApi, CalendarApiError } from './calendar-api.ts';
import { CATEGORIES, categoryFor } from './categories.ts';
import type { Category } from './categories.ts';
import { bodyForDraft, canWriteCalendar, draftFor, editingReason, newDraft, withTimingMode } from './editor-model.ts';
import type { TimingMode } from './editor-model.ts';
import DeleteConfirmation from './DeleteConfirmation.tsx';

export default function EventEditor({ api, calendars, original, startDate, onClose, onSaved, onExpired }: {
  api: CalendarApi; calendars: Calendar[]; original?: CalendarEvent;
  startDate?: string;
  onClose: () => void; onSaved: (calendarId: string, event?: CalendarEvent) => void; onExpired: (reason: string) => void;
}) {
  const writable = calendars.filter(canWriteCalendar);
  const [draft, setDraft] = useState(() => original ? draftFor(original) : newDraft(writable.find(c => c.primary) ?? writable[0], startDate));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pendingRef = useRef(false);
  const [controller] = useState(() => new AbortController());
  const dialog = useRef<HTMLDialogElement>(null);
  const calendar = calendars.find(c => c.id === draft.calendarId);
  const reason = original ? editingReason(original, calendar) : calendar && canWriteCalendar(calendar) ? '' : 'Choose a writable calendar.';

  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { controller.abort(); };
  }, [controller]);

  async function submit(deleting = false) {
    if (pendingRef.current) return;
    setError('');
    try {
      if (reason || !calendar) throw new Error(reason || 'Choose a writable calendar.');
      if (deleting && (!original || !confirmDelete)) throw new Error('Confirm deletion first.');
      if (!deleting) bodyForDraft(draft, original);
      pendingRef.current = true;
      setPending(true);
      const saved = deleting ? await api.deleteEvent(calendar, original!, controller.signal)
        : original ? await api.updateEvent(calendar, original, draft, controller.signal)
        : await api.createEvent(calendar, draft, controller.signal);
      if (!controller.signal.aborted) onSaved(calendar.id, saved || undefined);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof CalendarApiError && reason.status === 401) onExpired(reason.message);
      else setError(reason instanceof TypeError ? 'The result could not be confirmed. Keep this form to retry creation safely, or close and refresh before retrying an edit/deletion.'
        : reason instanceof Error ? reason.message : 'The event could not be saved. Please retry.');
    } finally {
      pendingRef.current = false;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return <dialog ref={dialog} className="event-details event-editor" aria-labelledby="editor-heading" onCancel={event => {
    if (pendingRef.current) event.preventDefault(); else onClose();
  }}>
    <form className="details-content" onSubmit={event => { event.preventDefault(); if (!confirmDelete) void submit(); }}>
      <header><h2 id="editor-heading">{original ? 'Edit event' : 'New event'}</h2><button type="button" disabled={pending} onClick={onClose}>Cancel</button></header>
      <fieldset disabled={pending || confirmDelete}>
        <label>Title<input autoFocus required maxLength={1024} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <div className="editor-row">
          <label>Calendar<select value={draft.calendarId} disabled={Boolean(original)} onChange={e => {
            const next = writable.find(c => c.id === e.target.value)!;
            setDraft({ ...draft, calendarId: next.id, timeZone: next.timeZone || 'Europe/London', category: categoryFor({ calendarId: next.id } as CalendarEvent) });
          }}>{writable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Category<select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as Category })}>
            {Object.keys(CATEGORIES).map(category => <option key={category}>{category}</option>)}
          </select></label>
        </div>
        <label>Timing mode<select value={draft.mode} onChange={e => setDraft(withTimingMode(draft, e.target.value as TimingMode))}>
          {['All day', 'AM', 'PM', 'Evening', 'Custom'].map(mode => <option key={mode}>{mode}</option>)}
        </select></label>
        <div className="editor-row">
          <label>Start date<input type="date" required value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
          <label>End date<input type="date" required value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></label>
        </div>
        {draft.mode === 'All day' ? <p className="editor-hint">End date is included. Google stores the following date as the exclusive end.</p> : <>
          <div className="editor-row">
            <label>Start time<input type="time" required step="0.001" readOnly={draft.mode !== 'Custom'} value={draft.startTime} onChange={e => setDraft({ ...draft, startTime: e.target.value })} /></label>
            <label>End time<input type="time" required step="0.001" readOnly={draft.mode !== 'Custom'} value={draft.endTime} onChange={e => setDraft({ ...draft, endTime: e.target.value })} /></label>
          </div>
          <label>Time zone<input required value={draft.timeZone} onChange={e => setDraft({ ...draft, timeZone: e.target.value })} /></label>
          <p className="editor-hint">Times use this zone. For an overnight event, set the end date to the following day. Existing exact timestamps stay unchanged until you edit their timing.</p>
        </>}
        <label>Note / description<textarea rows={3} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      </fieldset>
      {(error || reason) && <p role="alert">{error || reason}</p>}
      {confirmDelete ? <DeleteConfirmation title={original?.title ?? ''} calendarName={calendar?.name ?? ''} pending={pending}
        onConfirm={() => void submit(true)} onCancel={() => setConfirmDelete(false)} /> : <div className="editor-actions">
        {original && <button type="button" className="delete-event" disabled={pending || Boolean(reason)} onClick={() => setConfirmDelete(true)}>Delete event</button>}
        <button type="submit" disabled={pending || Boolean(reason)}>{pending ? 'Saving…' : 'Save event'}</button>
      </div>}
      {pending && <p role="status">Saving changes to Google Calendar…</p>}
    </form>
  </dialog>;
}
