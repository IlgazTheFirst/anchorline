import { useState } from 'react';
import type { ConstraintResult } from '../../domain/constraints';
import { StatusBadge } from '../../ui/components';

export function ChecksPanel({ results }: { results: ConstraintResult[] }) {
  const [showMet, setShowMet] = useState(false);
  const [showAllOpen, setShowAllOpen] = useState(false);
  const violated = results.filter((r) => r.status === 'violated');
  const open = results.filter((r) => r.status === 'unresolved');
  const met = results.filter((r) => r.status === 'satisfied');
  const item = (r: ConstraintResult) => (
    <div key={r.id} className={`check ${r.status}`}>
      <StatusBadge status={r.status} /> <strong>{r.label}</strong>
      <p>{r.explanation}</p>
      {r.status !== 'satisfied' && r.relaxations.length > 0 && (
        <ul>
          {r.relaxations.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <section className="card" aria-labelledby="checks-h">
      <h2 id="checks-h">Checks</h2>
      <p className="num">
        <StatusBadge status="violated" /> {violated.length} · <StatusBadge status="unresolved" /> {open.length} · <StatusBadge status="satisfied" /> {met.length}
      </p>
      {violated.map(item)}
      {(showAllOpen ? open : open.slice(0, 3)).map(item)}
      {open.length > 3 && (
        <button type="button" className="link" aria-expanded={showAllOpen} onClick={() => setShowAllOpen((v) => !v)}>
          {showAllOpen ? 'Show fewer open questions' : `Show all ${open.length} open questions`}
        </button>
      )}
      <br />
      <button type="button" className="link" aria-expanded={showMet} onClick={() => setShowMet((s) => !s)}>
        {showMet ? 'Hide met checks' : `Show ${met.length} met check${met.length === 1 ? '' : 's'}`}
      </button>
      {showMet && met.map(item)}
    </section>
  );
}
