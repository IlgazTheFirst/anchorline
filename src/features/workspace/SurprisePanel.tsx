import { useState } from 'react';
import { DEFAULT_PACK } from '../../catalogue';
import { formatDate } from '../../domain/dates';
import { suggestSurprises, type Surprise } from '../../planner/surprise';
import { SafeLink } from '../../ui/components';
import type { TripSession } from '../useTripSession';

export function SurprisePanel({ session }: { session: TripSession }) {
  const doc = session.doc!;
  const [round, setRound] = useState(0);
  const [items, setItems] = useState<Surprise[] | null>(null);
  const ask = (r: number) => {
    setRound(r);
    setItems(suggestSurprises(doc, DEFAULT_PACK, r));
  };
  return (
    <section className="card" aria-labelledby="surprise-h">
      <h2 id="surprise-h">Surprise me</h2>
      <p className="muted">Up to three optional extras that fit your interests and a genuinely free day. Locked plans and rest periods are never touched.</p>
      <button type="button" onClick={() => ask(items ? round + 1 : 0)}>
        {items ? 'Show different ideas' : 'Suggest something'}
      </button>
      {items && items.length === 0 && <p style={{ marginTop: '0.5rem' }}>No suitable free days or catalogue experiences right now. Catalogue suggestions cover {DEFAULT_PACK.title}.</p>}
      {items?.map((s) => (
        <div key={s.key} className="check satisfied" style={{ marginTop: '0.75rem' }}>
          <h3>{s.title}</h3>
          <p>
            <strong>
              {s.placeName}, {formatDate(s.date)}
            </strong>
          </p>
          <p>{s.reason}</p>
          <p className="muted">{s.timeNote}</p>
          <p className="muted">{s.budgetNote}</p>
          <p>
            <SafeLink href={s.sourceUrl}>Source</SafeLink>
          </p>
          <button type="button" className="small primary" onClick={() => session.propose(`Add surprise: ${s.title}`, s.commands, 'planner')}>
            Preview adding it
          </button>
        </div>
      ))}
    </section>
  );
}
