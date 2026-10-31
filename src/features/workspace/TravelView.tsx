import { useState } from 'react';
import { newId } from '../../application/newTrip';
import { claimApplicability } from '../../domain/claims';
import { legFeasibility } from '../../domain/constraints';
import { formatMinutes, formatZoned, isValidLocalDateTime, resolveZoned } from '../../domain/dates';
import type { TravelLeg, ZonedTimeT } from '../../domain/schema';
import { Badge, Field, StatusBadge } from '../../ui/components';
import type { TripSession } from '../useTripSession';
import { placeName, placeZone } from './helpers';

const TIMING: Record<TravelLeg['timingStatus'], string> = {
  synthetic_planning_assumption: 'Fictional timing',
  planning_assumption: 'Planning estimate',
  user_entered: 'Entered by you',
  unknown: 'No times yet',
};

function TimeInputs({ label, value, zone, onChange }: { label: string; value: ZonedTimeT | null; zone: string; onChange: (v: ZonedTimeT | null) => void }) {
  const [local, setLocal] = useState(value?.localDateTime ?? '');
  const [offset, setOffset] = useState(value?.offset ?? '');
  const tz = value?.timeZone ?? zone;
  const r = local && isValidLocalDateTime(local) ? resolveZoned({ localDateTime: local, timeZone: tz }) : null;
  const emit = (l: string, o: string) => onChange(l && isValidLocalDateTime(l) ? { localDateTime: l.slice(0, 16), timeZone: tz, offset: o || null } : null);
  return (
    <div>
      <Field label={`${label} (local time, ${tz})`}>
        {(id) => (
          <input
            id={id}
            type="datetime-local"
            value={local}
            onChange={(e) => {
              setLocal(e.target.value);
              emit(e.target.value, offset);
            }}
          />
        )}
      </Field>
      {r?.status === 'ambiguous' && (
        <Field label="This time happens twice (clocks go back). Which one?">
          {(id) => (
            <select
              id={id}
              value={offset}
              onChange={(e) => {
                setOffset(e.target.value);
                emit(local, e.target.value);
              }}
            >
              <option value="">Choose…</option>
              {r.candidates.map((c, i) => (
                <option key={c} value={c}>
                  {i === 0 ? 'First' : 'Second'} occurrence (UTC{c})
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {r?.status === 'nonexistent' && <p className="field-error">{r.message}</p>}
    </div>
  );
}

export function TravelView({ session }: { session: TripSession }) {
  const doc = session.doc!;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<TravelLeg>>({});
  const [addFrom, setAddFrom] = useState(doc.homePlaceId);
  const [addTo, setAddTo] = useState(doc.places[1]?.id ?? doc.homePlaceId);
  const [addMode, setAddMode] = useState('');
  if (!doc.travelLegs.length) return <p>No journeys yet. They appear when you add stays.</p>;
  return (
    <div>
      {doc.travelLegs.map((l) => {
        const f = legFeasibility(l);
        const evidence = doc.claims.filter((c) => l.evidenceIds.includes(c.id));
        const stale = evidence.filter((c) => !claimApplicability(doc, c).applicable);
        const locked = (l.lockedFields ?? []).length > 0;
        const booked = doc.bookingMarks.some((b) => b.subjectId === l.id && b.status !== 'cancelled');
        return (
          <section key={l.id} className="card" aria-label={`${placeName(doc, l.fromPlaceId)} to ${placeName(doc, l.toPlaceId)}`}>
            <h3>
              {placeName(doc, l.fromPlaceId)} → {placeName(doc, l.toPlaceId)} <StatusBadge status={f.status} /> <Badge>{TIMING[l.timingStatus]}</Badge> {locked && <Badge kind="lock">times locked</Badge>}{' '}
              {booked && <Badge kind="ok">Booked (recorded by you)</Badge>}
            </h3>
            <p>
              <strong>{l.mode}</strong>
              {l.identifiers?.from || l.identifiers?.to ? ` · ${l.identifiers?.from ?? '?'} → ${l.identifiers?.to ?? '?'}` : ''}
              {l.durationRangeMinutes ? ` · about ${formatMinutes(l.durationRangeMinutes.min)}–${formatMinutes(l.durationRangeMinutes.max)} (estimate)` : ''}
            </p>
            <p className="num">
              Departs: {l.departure ? formatZoned(l.departure) : 'not set'}
              <br />
              Arrives: {l.arrival ? formatZoned(l.arrival) : 'not set'}
              <br />
              <small className="muted">
                Allow {formatMinutes(l.preDepartureBufferMinutes)} before departure and {formatMinutes(l.postArrivalBufferMinutes)} after arrival.
              </small>
            </p>
            <p>{f.message}</p>
            {l.note && <p className="muted">{l.note}</p>}
            {evidence.length > 0 && (
              <p className="muted">
                {evidence.length} evidence record{evidence.length === 1 ? '' : 's'}
                {stale.length ? `, ${stale.length} no longer applicable to this route` : ''}. See the Evidence tab.
              </p>
            )}
            <div className="actions">
              <button type="button" className="small" onClick={() => { setEditing(editing === l.id ? null : l.id); setDraft({ mode: l.mode, departure: l.departure, arrival: l.arrival, preDepartureBufferMinutes: l.preDepartureBufferMinutes, postArrivalBufferMinutes: l.postArrivalBufferMinutes }); }} aria-expanded={editing === l.id} disabled={locked}>
                Edit journey…
              </button>
              <button type="button" className="small" onClick={() => session.propose(`${locked ? 'Unlock' : 'Lock'} journey times`, [{ type: locked ? 'UnlockField' : 'LockField', subjectId: l.id, field: 'times' }])}>
                {locked ? 'Unlock times' : 'Lock times'}
              </button>
              <button type="button" className="small" onClick={() => session.propose('Record booking for a journey', [{ type: 'RecordBooking', mark: { id: newId('booking'), subjectId: l.id, status: 'booked', recordedAt: new Date().toISOString(), recordedBy: 'user' } }])}>
                I have booked this
              </button>
              <button type="button" className="small danger" onClick={() => session.propose('Remove a journey', [{ type: 'RemoveTravelLeg', legId: l.id }])} disabled={locked}>
                Remove
              </button>
            </div>
            {editing === l.id && (
              <div style={{ marginTop: '0.75rem' }}>
                <Field label="How (mode, carrier or service)">{(id) => <input id={id} value={draft.mode ?? ''} onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value }))} />}</Field>
                <div className="row">
                  <TimeInputs label="Departs" value={l.departure} zone={placeZone(doc, l.fromPlaceId)} onChange={(v) => setDraft((d) => ({ ...d, departure: v }))} />
                  <TimeInputs label="Arrives" value={l.arrival} zone={placeZone(doc, l.toPlaceId)} onChange={(v) => setDraft((d) => ({ ...d, arrival: v }))} />
                </div>
                <div className="row">
                  <Field label="Minutes needed before departure">{(id) => <input id={id} type="number" min={0} max={1440} value={draft.preDepartureBufferMinutes ?? 0} onChange={(e) => setDraft((d) => ({ ...d, preDepartureBufferMinutes: Math.max(0, Number(e.target.value) || 0) }))} />}</Field>
                  <Field label="Minutes after arrival (transfer)">{(id) => <input id={id} type="number" min={0} max={1440} value={draft.postArrivalBufferMinutes ?? 0} onChange={(e) => setDraft((d) => ({ ...d, postArrivalBufferMinutes: Math.max(0, Number(e.target.value) || 0) }))} />}</Field>
                </div>
                <button
                  type="button"
                  className="primary small"
                  onClick={() => {
                    session.propose(`Edit journey ${placeName(doc, l.fromPlaceId)} → ${placeName(doc, l.toPlaceId)}`, [
                      { type: 'UpdateTravelLeg', legId: l.id, patch: { mode: draft.mode || l.mode, departure: draft.departure ?? null, arrival: draft.arrival ?? null, preDepartureBufferMinutes: draft.preDepartureBufferMinutes ?? 0, postArrivalBufferMinutes: draft.postArrivalBufferMinutes ?? 0 } },
                    ]);
                    setEditing(null);
                  }}
                >
                  Preview journey change
                </button>
              </div>
            )}
          </section>
        );
      })}
      <section className="card" aria-labelledby="add-leg-h">
        <h3 id="add-leg-h">Add a journey by hand</h3>
        <div className="row">
          <Field label="From">
            {(id) => (
              <select id={id} value={addFrom} onChange={(e) => setAddFrom(e.target.value)}>
                {doc.places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="To">
            {(id) => (
              <select id={id} value={addTo} onChange={(e) => setAddTo(e.target.value)}>
                {doc.places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="How">{(id) => <input id={id} value={addMode} onChange={(e) => setAddMode(e.target.value)} placeholder="e.g. day-trip minibus" />}</Field>
        </div>
        <button
          type="button"
          className="small"
          disabled={addFrom === addTo}
          onClick={() =>
            session.propose('Add a journey', [
              { type: 'AddTravelLeg', leg: { id: newId('leg'), fromPlaceId: addFrom, toPlaceId: addTo, mode: addMode || 'to be decided', departure: null, arrival: null, durationRangeMinutes: null, preDepartureBufferMinutes: 30, postArrivalBufferMinutes: 15, timingStatus: 'unknown', identifiers: null, evidenceIds: [], lockedFields: [], note: null } },
            ])
          }
        >
          Preview journey
        </button>
      </section>
    </div>
  );
}
