import { useState } from 'react';
import { newId } from '../../application/newTrip';
import { DEFAULT_PACK } from '../../catalogue';
import { addDays, formatDate, isValidPlainDate } from '../../domain/dates';
import { sortStays, stayNights } from '../../domain/derive';
import type { Place, Stay } from '../../domain/schema';
import { Badge, Field } from '../../ui/components';
import type { TripSession } from '../useTripSession';
import { placeName } from './helpers';
import { PlacePicker } from './shared';

export function StaysView({ session }: { session: TripSession }) {
  const doc = session.doc!;
  const stays = sortStays(doc.stays);
  const [shift, setShift] = useState(true);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<Place | null>(null);
  const [newPlace, setNewPlace] = useState<Place | null>(null);
  const lastOut = stays[stays.length - 1]?.checkOutExclusive ?? doc.window?.firstNight ?? doc.departureDate;
  const [newCheckIn, setNewCheckIn] = useState(lastOut);
  const [newNights, setNewNights] = useState(3);
  const [details, setDetails] = useState<string | null>(null);
  const [accName, setAccName] = useState('');
  const [accAddress, setAccAddress] = useState('');
  const [bookingRef, setBookingRef] = useState('');

  const name = (s: Stay) => placeName(doc, s.placeId);
  const isCustom = (s: Stay) => {
    const p = doc.places.find((x) => x.id === s.placeId);
    return Boolean(p && p.dataKind === 'user' && !p.catalogueId && !DEFAULT_PACK.places.some((c) => c.id === p.id));
  };
  const resize = (s: Stay, delta: number) => {
    const nights = stayNights(s) + delta;
    if (nights < 1) return;
    session.propose(`${name(s)}: ${nights} night${nights === 1 ? '' : 's'}`, [{ type: 'ResizeStay', stayId: s.id, nights, shiftFollowing: shift }]);
  };
  const bookings = (s: Stay) => doc.bookingMarks.filter((b) => b.subjectId === s.id && b.status !== 'cancelled');

  return (
    <div>
      <div className="card">
        <Field label="When I change nights, move the later stops too" inline>
          {(id) => <input id={id} type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />}
        </Field>
        <p className="muted">Untick to change only this stay; overlaps or gaps then show up as checks.</p>
      </div>
      {stays.length === 0 && <p>No stays yet.</p>}
      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {stays.map((s, i) => {
          const datesLocked = s.lockedFields.includes('checkIn') || s.lockedFields.includes('checkOutExclusive');
          const placeLocked = s.lockedFields.includes('placeId');
          const nights = stayNights(s);
          return (
            <li key={s.id} className="card" aria-label={`${name(s)}, ${nights} nights`}>
              <div className="stay">
                <div className="nights num">
                  <strong>{nights}</strong> night{nights === 1 ? '' : 's'}
                </div>
                <h3 style={{ margin: 0 }}>
                  {i + 1}. {name(s)}{' '}
                  {datesLocked && (
                    <Badge kind="lock">
                      <span aria-hidden="true">🔒</span> dates locked
                    </Badge>
                  )}{' '}
                  {placeLocked && (
                    <Badge kind="lock">
                      <span aria-hidden="true">🔒</span> place locked
                    </Badge>
                  )}{' '}
                  {bookings(s).length > 0 && <Badge kind="ok">Booked (recorded by you)</Badge>}
                </h3>
                <div className="dates num">
                  {formatDate(s.checkIn)} → {formatDate(s.checkOutExclusive)}
                </div>
                <div className="tags">
                  {s.purposeTags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                  {s.accommodation?.name && <span className="tag">Staying at {s.accommodation.name}</span>}
                </div>
              </div>
              {s.reason && <p style={{ marginTop: '0.5rem' }}>{s.reason}</p>}
              {isCustom(s) && (
                <p className="banner info" style={{ margin: '0.5rem 0 0' }}>
                  <strong>Your own place.</strong> It is outside the {DEFAULT_PACK.title} catalogue, so there are no automatic routes, activities or season notes. Add journeys and activities yourself. A new plan keeps this stay on its dates.
                </p>
              )}
              <div className="actions">
                <button type="button" className="small" onClick={() => resize(s, -1)} disabled={nights <= 1 || datesLocked} aria-label={`One night fewer in ${name(s)}`}>
                  − night
                </button>
                <button type="button" className="small" onClick={() => resize(s, 1)} disabled={datesLocked} aria-label={`One night more in ${name(s)}`}>
                  + night
                </button>
                <button type="button" className="small" disabled={i === 0} onClick={() => session.propose(`Move ${name(s)} earlier`, [{ type: 'MoveStay', stayId: s.id, direction: 'earlier' }])} aria-label={`Move ${name(s)} earlier`}>
                  ↑ Earlier
                </button>
                <button type="button" className="small" disabled={i === stays.length - 1} onClick={() => session.propose(`Move ${name(s)} later`, [{ type: 'MoveStay', stayId: s.id, direction: 'later' }])} aria-label={`Move ${name(s)} later`}>
                  ↓ Later
                </button>
                <button type="button" className="small" onClick={() => setReplacing(replacing === s.id ? null : s.id)} aria-expanded={replacing === s.id}>
                  Replace…
                </button>
                <button
                  type="button"
                  className="small"
                  onClick={() =>
                    session.propose(`${datesLocked ? 'Unlock' : 'Lock'} dates of ${name(s)}`, [{ type: datesLocked ? 'UnlockField' : 'LockField', subjectId: s.id, field: 'dates' }])
                  }
                >
                  {datesLocked ? 'Unlock dates' : 'Lock dates'}
                </button>
                <button type="button" className="small" onClick={() => session.propose(`${placeLocked ? 'Unlock' : 'Lock'} place of ${name(s)}`, [{ type: placeLocked ? 'UnlockField' : 'LockField', subjectId: s.id, field: 'placeId' }])}>
                  {placeLocked ? 'Unlock place' : 'Lock place'}
                </button>
                <button type="button" className="small" onClick={() => {
                  setDetails(details === s.id ? null : s.id);
                  setAccName(s.accommodation?.name ?? '');
                  setAccAddress(s.accommodation?.address ?? '');
                }} aria-expanded={details === s.id}>
                  Stay details…
                </button>
                <button type="button" className="small danger" onClick={() => session.propose(`Remove ${name(s)}`, [{ type: 'RemoveStay', stayId: s.id, closeGap: shift }])}>
                  Remove
                </button>
              </div>
              {replacing === s.id && (
                <div style={{ marginTop: '0.75rem' }}>
                  <PlacePicker doc={doc} label={`Replace ${name(s)} with`} value={replacement} onChange={setReplacement} />
                  <button
                    type="button"
                    className="primary small"
                    disabled={!replacement}
                    onClick={() => {
                      if (!replacement) return;
                      session.propose(`Replace ${name(s)} with ${replacement.name}`, [{ type: 'ReplaceStop', stayId: s.id, place: replacement }]);
                      setReplacing(null);
                    }}
                  >
                    Preview replacement (same dates)
                  </button>
                </div>
              )}
              {details === s.id && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div className="row">
                    <Field label="Accommodation name" hint="(private unless you share it)">{(id) => <input id={id} value={accName} onChange={(e) => setAccName(e.target.value)} />}</Field>
                    <Field label="Address">{(id) => <input id={id} value={accAddress} onChange={(e) => setAccAddress(e.target.value)} />}</Field>
                  </div>
                  <button type="button" className="small" onClick={() => session.propose(`Accommodation for ${name(s)}`, [{ type: 'UpdateStay', stayId: s.id, patch: { accommodation: accName ? { name: accName, address: accAddress || undefined } : null } }])}>
                    Preview details
                  </button>
                  <div className="row" style={{ marginTop: '0.75rem' }}>
                    <Field label="Booking reference" hint="(optional, private)">{(id) => <input id={id} value={bookingRef} onChange={(e) => setBookingRef(e.target.value)} />}</Field>
                  </div>
                  <button
                    type="button"
                    className="small"
                    onClick={() =>
                      session.propose(`Record booking for ${name(s)}`, [
                        { type: 'RecordBooking', mark: { id: newId('booking'), subjectId: s.id, status: 'booked', recordedAt: new Date().toISOString(), recordedBy: 'user', reference: bookingRef || undefined } },
                      ])
                    }
                  >
                    I have booked this stay
                  </button>
                  <p className="muted">Recording a booking does not contact anyone. Editing the plan later never changes or cancels a real booking.</p>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <section className="card" aria-labelledby="add-stay-h">
        <h3 id="add-stay-h">Add a stop</h3>
        <PlacePicker doc={doc} label="Place" value={newPlace} onChange={setNewPlace} />
        <div className="row">
          <Field label="Check-in">{(id) => <input id={id} type="date" value={newCheckIn} onChange={(e) => setNewCheckIn(e.target.value)} />}</Field>
          <Field label="Nights">{(id) => <input id={id} type="number" min={1} max={60} value={newNights} onChange={(e) => setNewNights(Math.max(1, Number(e.target.value) || 1))} />}</Field>
        </div>
        <button
          type="button"
          className="primary small"
          disabled={!newPlace || !isValidPlainDate(newCheckIn)}
          onClick={() => {
            if (!newPlace) return;
            const stay: Stay = { id: newId('stay'), placeId: newPlace.id, checkIn: newCheckIn, checkOutExclusive: addDays(newCheckIn, newNights), purposeTags: newPlace.tags.slice(0, 4), lockedFields: [], accommodation: null, reason: 'Added by you.' };
            session.propose(`Add ${newPlace.name}`, [{ type: 'AddStay', stay, place: doc.places.some((p) => p.id === newPlace.id) ? undefined : newPlace, shiftFollowing: shift }]);
          }}
        >
          Preview new stop
        </button>
      </section>
    </div>
  );
}
