import { useState } from 'react';
import { newId } from '../../application/newTrip';
import type { ConstraintResult } from '../../domain/constraints';
import { isValidLocalDateTime } from '../../domain/dates';
import type { Activity, Anchor, Place } from '../../domain/schema';
import { Field, StatusBadge } from '../../ui/components';
import type { TripSession } from '../useTripSession';
import { placeName } from './helpers';
import { PlacePicker } from './shared';

type Kind = 'beach_nights' | 'beach_days' | 'min_nights' | 'visit' | 'avoid' | 'event' | 'deadline';

export function CommitmentsPanel({ session, results }: { session: TripSession; results: ConstraintResult[] }) {
  const doc = session.doc!;
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>('beach_nights');
  const [number, setNumber] = useState(5);
  const [place, setPlace] = useState<Place | null>(null);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(doc.window ? `${doc.window.firstNight}T19:00` : '');
  const [end, setEnd] = useState(doc.window ? `${doc.window.firstNight}T23:00` : '');
  const [error, setError] = useState('');
  const homeZone = doc.places.find((p) => p.id === doc.homePlaceId)?.timeZone ?? 'UTC';

  const submit = () => {
    setError('');
    const id = newId('anchor');
    let anchor: Anchor;
    const needPlace = ['min_nights', 'visit', 'avoid', 'event'].includes(kind);
    if (needPlace && !place) return setError('Choose a place.');
    const extra: { place?: Place; activity?: Activity } = {};
    if (place && !doc.places.some((p) => p.id === place.id)) extra.place = place;
    switch (kind) {
      case 'beach_nights':
        anchor = { id, kind: 'minimum_consecutive_nights', strength: 'hard', qualifyingTag: 'beach', minimumNights: number, label: `${number} consecutive beach nights` };
        break;
      case 'beach_days':
        anchor = { id, kind: 'minimum_full_days', strength: 'hard', qualifyingTag: 'beach', minimumDays: number, label: `${number} full beach days` };
        break;
      case 'min_nights':
        anchor = { id, kind: 'minimum_nights_at_place', strength: 'hard', placeId: place!.id, minimumNights: number, label: `At least ${number} nights in ${place!.name}` };
        break;
      case 'visit':
        anchor = { id, kind: 'required_place', strength: 'hard', placeId: place!.id, label: `Visit ${place!.name}` };
        break;
      case 'avoid':
        anchor = { id, kind: 'excluded_place', strength: 'hard', placeId: place!.id, label: `Avoid ${place!.name}` };
        break;
      case 'event': {
        if (!title.trim() || !isValidLocalDateTime(start) || !isValidLocalDateTime(end) || end <= start) return setError('Give the event a name and a start before its end.');
        const actId = newId('event');
        extra.activity = { id: actId, placeId: place!.id, title: title.trim(), start: { localDateTime: start, timeZone: place!.timeZone }, end: { localDateTime: end, timeZone: place!.timeZone }, tags: [], lockedFields: ['placeId', 'start', 'end'], dataKind: 'user' };
        anchor = { id, kind: 'fixed_event', strength: 'hard', activityId: actId, arrivalBufferMinutes: 60, label: `Be at ${title.trim()}` };
        break;
      }
      case 'deadline':
        if (!isValidLocalDateTime(end)) return setError('Enter the date and time you need to be home by.');
        anchor = { id, kind: 'arrival_deadline', strength: 'hard', placeId: doc.homePlaceId, deadline: { localDateTime: end, timeZone: homeZone }, includePostArrivalBuffer: true, label: 'Home deadline' };
        break;
    }
    session.propose(`Add commitment: ${anchor.label}`, [{ type: 'AddAnchor', anchor, ...extra }]);
    setAdding(false);
  };

  return (
    <section className="card" aria-labelledby="commit-h">
      <h2 id="commit-h">Commitments</h2>
      {doc.anchors.length === 0 && <p className="muted">No fixed commitments yet.</p>}
      <ul className="diff-list">
        {doc.anchors.map((a) => {
          const r = results.find((x) => x.anchorId === a.id && x.id === `anchor:${a.id}`);
          return (
            <li key={a.id}>
              {r && <StatusBadge status={r.status} />} <strong>{a.label ?? a.kind.replaceAll('_', ' ')}</strong> <small className="muted">{a.strength === 'hard' ? 'must' : 'nice to have'}</small>
              {'placeId' in a && a.kind !== 'arrival_deadline' ? <small className="muted"> · {placeName(doc, a.placeId)}</small> : null}
              <div>
                <button type="button" className="link" onClick={() => session.propose(`Remove commitment: ${a.label ?? a.kind}`, [{ type: 'RemoveAnchor', anchorId: a.id }])}>
                  Remove…
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!adding ? (
        <button type="button" className="small" onClick={() => setAdding(true)}>
          Add a commitment
        </button>
      ) : (
        <div>
          <Field label="Type">
            {(id) => (
              <select id={id} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="beach_nights">Consecutive beach nights</option>
                <option value="beach_days">Full beach days</option>
                <option value="min_nights">Minimum nights in a place</option>
                <option value="visit">Must visit a place</option>
                <option value="avoid">Avoid a place</option>
                <option value="event">Fixed event</option>
                <option value="deadline">Home by</option>
              </select>
            )}
          </Field>
          {['beach_nights', 'beach_days', 'min_nights'].includes(kind) && (
            <Field label={kind === 'beach_days' ? 'Days' : 'Nights'}>{(id) => <input id={id} type="number" min={1} max={90} value={number} onChange={(e) => setNumber(Math.max(1, Number(e.target.value) || 1))} />}</Field>
          )}
          {['min_nights', 'visit', 'avoid', 'event'].includes(kind) && <PlacePicker doc={doc} label="Place" value={place} onChange={setPlace} />}
          {kind === 'event' && (
            <>
              <Field label="Event name">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
              <Field label="Starts (local time there)">{(id) => <input id={id} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
            </>
          )}
          {(kind === 'event' || kind === 'deadline') && (
            <Field label={kind === 'event' ? 'Ends' : `Home by (${homeZone})`}>{(id) => <input id={id} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="primary small" onClick={submit}>
              Preview commitment
            </button>
            <button type="button" className="small" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
