import { useState } from 'react';
import { newId } from '../../application/newTrip';
import { formatDate, formatLocal, formatMinutes } from '../../domain/dates';
import { dayCards } from '../../domain/derive';
import type { Activity, PartOfDay } from '../../domain/schema';
import { Badge, Field } from '../../ui/components';
import type { TripSession } from '../useTripSession';
import { PART_ORDER, placeName } from './helpers';

export function DaysView({ session }: { session: TripSession }) {
  const doc = session.doc!;
  const cards = dayCards(doc);
  const [adding, setAdding] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [part, setPart] = useState<PartOfDay>('afternoon');
  const [moving, setMoving] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');
  if (!cards.length) return <p>No days yet. Add stays first.</p>;
  const when = (a: Activity) => (a.start ? `${formatLocal(a.start.localDateTime).split(' ').pop()}${a.end ? `–${formatLocal(a.end.localDateTime).split(' ').pop()}` : ''}` : (a.partOfDay ?? 'any time'));
  const sorted = (list: Activity[]) => [...list].sort((x, y) => PART_ORDER.indexOf(x.partOfDay ?? 'any') - PART_ORDER.indexOf(y.partOfDay ?? 'any') || (x.start?.localDateTime ?? '').localeCompare(y.start?.localDateTime ?? ''));
  return (
    <div className="card">
      {cards.map((c) => (
        <div key={c.date} className="day">
          <div className="day-head">
            <h3 style={{ margin: 0 }}>{formatDate(c.date)}</h3>
            <span>
              {c.placeIds.map((p) => placeName(doc, p)).join(' → ') || 'Travelling'} {c.isTransferDay && <Badge kind="open">Travel day</Badge>} {c.isFullDay && <Badge kind="neutral">Full day</Badge>}
            </span>
          </div>
          {c.legs.length > 0 && (
            <ul>
              {c.legs.map((l) => (
                <li key={l.id}>
                  {placeName(doc, l.fromPlaceId)} → {placeName(doc, l.toPlaceId)} ({l.mode}
                  {l.durationRangeMinutes ? `, about ${formatMinutes(l.durationRangeMinutes.min)}–${formatMinutes(l.durationRangeMinutes.max)}` : ''}
                  {l.departure ? `, departs ${formatLocal(l.departure.localDateTime)}` : ', time not set'})
                </li>
              ))}
            </ul>
          )}
          {c.activities.length > 0 && (
            <ul>
              {sorted(c.activities).map((a) => (
                <li key={a.id}>
                  <strong>{when(a)}:</strong> {a.title} {a.lockedFields.length > 0 && <Badge kind="lock">locked</Badge>} {a.dataKind === 'synthetic' && <Badge kind="open">fictional</Badge>}
                  {a.note && <div className="muted">{a.note}</div>}
                  {a.lockedFields.length === 0 && (
                    <span>
                      {' '}
                      <button type="button" className="link" onClick={() => { setMoving(moving === a.id ? null : a.id); setMoveTo(a.date ?? c.date); }} aria-expanded={moving === a.id}>
                        Move
                      </button>{' '}
                      <button type="button" className="link" onClick={() => session.propose(`Remove ${a.title}`, [{ type: 'RemoveActivity', activityId: a.id }])}>
                        Remove
                      </button>
                    </span>
                  )}
                  {moving === a.id && (
                    <div className="row">
                      <Field label={`Move ${a.title} to`}>
                        {(id) => (
                          <select id={id} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                            {cards.map((d) => (
                              <option key={d.date} value={d.date}>
                                {formatDate(d.date)}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                      <button type="button" className="small" onClick={() => { session.propose(`Move ${a.title} to ${formatDate(moveTo)}`, [{ type: 'UpdateActivity', activityId: a.id, patch: { date: moveTo, start: null, end: null } }]); setMoving(null); }}>
                        Preview move
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {c.isFullDay && c.freeParts.length > 0 && <p className="muted">Free: {c.freeParts.join(', ')}.</p>}
          {c.placeIds.length > 0 && (
            <button type="button" className="link" onClick={() => { setAdding(adding === c.date ? null : c.date); setTitle(''); }} aria-expanded={adding === c.date}>
              Add an activity
            </button>
          )}
          {adding === c.date && (
            <div className="row">
              <Field label="What">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
              <Field label="When">
                {(id) => (
                  <select id={id} value={part} onChange={(e) => setPart(e.target.value as PartOfDay)}>
                    {(['morning', 'afternoon', 'evening', 'any'] as PartOfDay[]).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                )}
              </Field>
              <button
                type="button"
                className="small primary"
                disabled={!title.trim()}
                onClick={() => {
                  const placeId = c.placeIds[c.placeIds.length - 1]!;
                  session.propose(`Add ${title.trim()}`, [{ type: 'AddActivity', activity: { id: newId('act'), placeId, title: title.trim(), date: c.date, partOfDay: part, tags: [], lockedFields: [], dataKind: 'user', start: null, end: null } }]);
                  setAdding(null);
                }}
              >
                Preview activity
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
