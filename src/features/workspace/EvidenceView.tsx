import { useState } from 'react';
import { newId } from '../../application/newTrip';
import { claimApplicability, EVIDENCE_LABELS, scopeOf } from '../../domain/claims';
import { formatDate, isValidPlainDate } from '../../domain/dates';
import { isSafeHttpUrl, type Claim } from '../../domain/schema';
import { Badge, Field, SafeLink } from '../../ui/components';
import type { TripSession } from '../useTripSession';
import { placeName } from './helpers';

export function EvidenceView({ session }: { session: TripSession }) {
  const doc = session.doc!;
  const [subject, setSubject] = useState('');
  const [status, setStatus] = useState<Claim['evidenceStatus']>('source_documented');
  const [url, setUrl] = useState('');
  const [checkedAt, setCheckedAt] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const label = (id: string) => {
    const s = doc.stays.find((x) => x.id === id);
    if (s) return `Stay in ${placeName(doc, s.placeId)}`;
    const l = doc.travelLegs.find((x) => x.id === id);
    if (l) return `${placeName(doc, l.fromPlaceId)} → ${placeName(doc, l.toPlaceId)}`;
    const a = doc.activities.find((x) => x.id === id);
    if (a) return a.title;
    const p = doc.places.find((x) => x.id === id);
    if (p) return p.name;
    return 'Removed from the plan';
  };
  const subjects = [...doc.stays.map((s) => s.id), ...doc.travelLegs.map((l) => l.id), ...doc.activities.map((a) => a.id)];
  const add = () => {
    setError('');
    if (!subject) return setError('Choose what the evidence is about.');
    if (url && !isSafeHttpUrl(url)) return setError('Only http(s) links are allowed.');
    if (!isValidPlainDate(checkedAt)) return setError('Enter the date you checked it.');
    const claim: Claim = {
      id: newId('claim'),
      subjectId: subject,
      kind: doc.travelLegs.some((l) => l.id === subject) ? (status === 'live_quote' ? 'price' : 'route_timing') : status === 'live_quote' ? 'price' : 'activity_info',
      evidenceStatus: status,
      sourceUrl: url || null,
      checkedAt,
      dataKind: 'user',
      dependsOn: scopeOf(doc, subject) ?? undefined,
      note: note || null,
    };
    session.propose(`Add evidence for ${label(subject)}`, [{ type: 'AddClaim', claim }]);
    setNote('');
    setUrl('');
  };
  return (
    <div>
      <section className="card">
        <h2>Evidence</h2>
        <p className="muted">
          Where each claim comes from. A source that documents a route is not a timetable, a timetable is not a seat, and nothing here is a booking unless you record one.
        </p>
        {doc.claims.length === 0 && <p>No evidence recorded.</p>}
        <ul className="diff-list">
          {doc.claims.map((c) => {
            const a = claimApplicability(doc, c);
            return (
              <li key={c.id}>
                <strong>{label(c.subjectId)}</strong> <Badge kind={c.evidenceStatus === 'synthetic' ? 'open' : c.evidenceStatus === 'planning_assumption' ? 'neutral' : 'ok'}>{EVIDENCE_LABELS[c.evidenceStatus]}</Badge>{' '}
                {!a.applicable && <Badge kind="bad">No longer applies</Badge>}
                <div>
                  <SafeLink href={c.sourceUrl}>Source</SafeLink>
                  {c.checkedAt ? <small className="muted"> · checked {formatDate(c.checkedAt, { year: true })}</small> : null}
                </div>
                {c.note && <p className="muted">{c.note}</p>}
                {!a.applicable && <p className="field-error">{a.reason}</p>}
              </li>
            );
          })}
        </ul>
      </section>
      <section className="card" aria-labelledby="add-ev-h">
        <h3 id="add-ev-h">Record evidence you checked</h3>
        <Field label="About">
          {(id) => (
            <select id={id} value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Choose…</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="row">
          <Field label="What you checked">
            {(id) => (
              <select id={id} value={status} onChange={(e) => setStatus(e.target.value as Claim['evidenceStatus'])}>
                <option value="source_documented">A source describes it</option>
                <option value="dated_schedule">A timetable for this date</option>
                <option value="live_quote">A price quote</option>
                <option value="user_recorded">My own note</option>
              </select>
            )}
          </Field>
          <Field label="Checked on">{(id) => <input id={id} type="date" value={checkedAt} onChange={(e) => setCheckedAt(e.target.value)} />}</Field>
        </div>
        <Field label="Link" hint="(http or https only)">{(id) => <input id={id} type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
        <Field label="Note">{(id) => <textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="button" className="primary small" onClick={add}>
          Preview evidence
        </button>
      </section>
    </div>
  );
}
