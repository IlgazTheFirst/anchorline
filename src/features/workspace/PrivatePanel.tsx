import { useState } from 'react';
import { newId } from '../../application/newTrip';
import { Field } from '../../ui/components';
import type { TripSession } from '../useTripSession';

/** Traveller details and notes that stay in private backups and never go into a shareable copy. */
export function PrivatePanel({ session }: { session: TripSession }) {
  const doc = session.doc!;
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState(doc.travellerDetails.names.join('\n'));
  const [contacts, setContacts] = useState(doc.travellerDetails.contacts.join('\n'));
  const [note, setNote] = useState('');
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 50);
  return (
    <section className="card" aria-labelledby="private-h">
      <h2 id="private-h">Private details</h2>
      <p className="muted">Kept in this browser and in private backups only. Never included in a shareable copy.</p>
      <button type="button" className="small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide private details' : `Show private details (${doc.privateNotes.length} note${doc.privateNotes.length === 1 ? '' : 's'})`}
      </button>
      {open && (
        <div style={{ marginTop: '0.75rem' }}>
          <Field label="Traveller names" hint="(one per line)">{(id) => <textarea id={id} value={names} onChange={(e) => setNames(e.target.value)} />}</Field>
          <Field label="Contacts" hint="(one per line)">{(id) => <textarea id={id} value={contacts} onChange={(e) => setContacts(e.target.value)} />}</Field>
          <button type="button" className="small" onClick={() => session.propose('Update traveller details', [{ type: 'SetTravellerDetails', names: lines(names), contacts: lines(contacts) }])}>
            Preview traveller details
          </button>
          <h3 style={{ marginTop: '1rem' }}>Notes</h3>
          <ul>
            {doc.privateNotes.map((n) => (
              <li key={n.id}>
                {n.text}{' '}
                <button type="button" className="link" onClick={() => session.propose('Remove a private note', [{ type: 'RemovePrivateNote', noteId: n.id }])}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <Field label="New note">{(id) => <textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <button
            type="button"
            className="small"
            disabled={!note.trim()}
            onClick={() => {
              session.propose('Add a private note', [{ type: 'SetPrivateNote', note: { id: newId('note'), subjectId: null, text: note.trim() } }]);
              setNote('');
            }}
          >
            Preview note
          </button>
        </div>
      )}
    </section>
  );
}
