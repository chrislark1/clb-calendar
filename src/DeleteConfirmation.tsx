export default function DeleteConfirmation({ title, calendarName, pending, onConfirm, onCancel }: {
  title: string; calendarName: string; pending: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return <div className="delete-confirmation">
    <p>Delete “{title}” from {calendarName}? This removes the event from Google Calendar.</p>
    <div className="actions"><button type="button" disabled={pending} onClick={onConfirm}>Confirm delete</button>
      <button type="button" disabled={pending} onClick={onCancel}>Keep event</button></div>
  </div>;
}
