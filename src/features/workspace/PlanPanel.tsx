import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PACK } from '../../catalogue';
import { formatDate } from '../../domain/dates';
import { planForTrip, planToCommands } from '../../planner/fromTrip';
import type { PlanResult } from '../../planner/types';
import type { TripSession } from '../useTripSession';

function rationaleOf(r: PlanResult): string {
  return [r.summary, ...r.reasons].join('\n').slice(0, 5000);
}

export function PlanPanel({ session, autoGenerate = false }: { session: TripSession; autoGenerate?: boolean }) {
  const doc = session.doc!;
  const [result, setResult] = useState<PlanResult | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [showWhy, setShowWhy] = useState(true);

  const generate = (sequence?: string[]) => {
    const r = planForTrip(doc, DEFAULT_PACK, sequence ? { sequence } : {});
    setProblems(r.problems);
    setResult(r.result);
    if (r.result?.status === 'ok') session.propose(sequence ? 'Use an alternative route' : doc.stays.length ? 'Regenerate the plan' : 'Generate a plan', planToCommands(r.result), 'planner', rationaleOf(r.result));
  };

  const auto = useRef(autoGenerate);
  useEffect(() => {
    if (!auto.current) return;
    auto.current = false;
    if (window.location.hash.includes('?generate=1')) history.replaceState(null, '', `#/trip/${doc.id}`);
    const r = planForTrip(doc, DEFAULT_PACK);
    setProblems(r.problems);
    setResult(r.result);
    if (r.result?.status === 'ok') session.propose('Generate a plan', planToCommands(r.result), 'planner', rationaleOf(r.result));
  }, [doc, session]);

  const explanation = doc.planExplanation;
  return (
    <section className="card" aria-labelledby="plan-h">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 id="plan-h" style={{ margin: 0 }}>
          Plan
        </h2>
        {!doc.isSynthetic && (
          <button type="button" className="primary" onClick={() => generate()} disabled={!doc.window}>
            {doc.stays.length ? 'Suggest a new plan' : 'Generate a plan'}
          </button>
        )}
      </div>
      {!doc.isSynthetic && (
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          Automatic planning covers {DEFAULT_PACK.title} ({DEFAULT_PACK.places.length} places, checked {formatDate(DEFAULT_PACK.checkedAt, { year: true })}). Travel times are planning estimates, never timetables or
          fares. Anywhere else, add your own places by hand; a new plan keeps their stays on the same dates, along with your locks and fixed events, and is shown as a preview first.
        </p>
      )}
      {problems.length > 0 && (
        <div className="banner warn" role="alert">
          {problems.join(' ')}
        </div>
      )}
      {result?.status === 'infeasible' && (
        <div className="banner warn" role="alert">
          <strong>No plan meets every commitment. Nothing was changed or relaxed.</strong>
          {result.conflicts.map((c) => (
            <div key={c.title + c.explanation} style={{ marginTop: '0.5rem' }}>
              <p>
                <strong>{c.title}.</strong> {c.explanation}
              </p>
              {c.relaxations.length > 0 && (
                <>
                  <p>You could:</p>
                  <ul>
                    {c.relaxations.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {result?.status === 'ok' && result.alternatives.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <h3>Other routes considered</h3>
          <ul className="diff-list">
            {result.alternatives.map((a) => (
              <li key={a.places.join('>')} className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {a.summary} <small className="muted">(score {a.scoreDelta.toFixed(2)} vs the suggestion)</small>
                </span>
                <button type="button" className="small" onClick={() => generate(a.places)}>
                  Preview this route
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {explanation && (
        <div style={{ marginTop: '0.5rem' }}>
          <p>
            <strong>{explanation.summary}</strong>
          </p>
          <button type="button" className="link" aria-expanded={showWhy} onClick={() => setShowWhy((s) => !s)}>
            {showWhy ? 'Hide reasons' : 'Why this plan?'}
          </button>
          {showWhy && (
            <>
              <ul>
                {explanation.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {explanation.unresolved.length > 0 && (
                <>
                  <h3>Still to check</h3>
                  <ul>
                    {explanation.unresolved.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
      )}
      {!explanation && !doc.stays.length && !result && <p>No stays yet. Generate a plan, or add stays by hand in the Stays tab.</p>}
    </section>
  );
}
