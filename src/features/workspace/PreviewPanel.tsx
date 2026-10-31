import { useEffect, useRef } from 'react';
import type { ItemChange } from '../../application/proposal';
import { formatMinutes } from '../../domain/dates';
import { formatRange, type BudgetSummary } from '../../domain/money';
import { StatusBadge } from '../../ui/components';
import type { TripSession } from '../useTripSession';

function Changes({ title, items }: { title: string; items: ItemChange[] }) {
  if (!items.length) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul className="diff-list">
        {items.map((c) => (
          <li key={c.id + c.change}>
            <strong>{c.change === 'added' ? 'Added' : c.change === 'removed' ? 'Removed' : 'Changed'}:</strong> {c.change === 'removed' ? c.before : c.after}
            {c.change === 'changed' && c.before && (
              <>
                <br />
                <span className="was">{c.before}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function budgetLine(s: BudgetSummary): string {
  const known = s.byCurrency.map((c) => formatRange({ minMinor: c.knownMinMinor, maxMinor: c.knownMaxMinor }, c.currency, c.minorUnitDigits)).join(' + ') || 'nothing priced';
  return `${known}; ${s.unknownItems.length} unknown${s.inapplicableItems.length ? `, ${s.inapplicableItems.length} no longer applicable` : ''}`;
}

export function PreviewPanel({ session }: { session: TripSession }) {
  const p = session.preview!;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'nearest' });
  }, [p.proposal?.id]);
  const d = p.diff;
  const statusText = {
    ready: 'Ready to apply. Nothing changes until you choose Apply.',
    blocked: 'This change would break a commitment, so it cannot replace your plan.',
    stale: 'This change was prepared for an older version of the plan.',
    rejected: 'This change is not allowed.',
    invalid: 'This change is not valid.',
  }[p.status];
  return (
    <section className={`card preview ${p.status}`} aria-labelledby="preview-h" data-testid="preview">
      <h2 id="preview-h" ref={heading} tabIndex={-1}>
        Preview: {p.proposal?.label ?? 'change'}
      </h2>
      <p role="status">
        <strong>{statusText}</strong>
      </p>
      {p.proposal?.rationale && (
        <div className="banner info">
          {p.proposal.rationale.split('\n').map((line) => (
            <p key={line} style={{ margin: '0.15rem 0' }}>
              {line}
            </p>
          ))}
        </div>
      )}
      {p.messages.length > 0 && (
        <ul>
          {p.messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {d && (
        <>
          <p className="num">
            Nights: {d.nights.before} → <strong>{d.nights.after}</strong>. Known travel time: {formatMinutes(d.travel.knownMinutesBefore)} → {formatMinutes(d.travel.knownMinutesAfter)}; journeys without times: {d.travel.unknownBefore} → {d.travel.unknownAfter}.
          </p>
          <Changes title="Stays" items={d.stays} />
          <Changes title="Journeys" items={d.legs} />
          <Changes title="Activities" items={d.activities} />
          {d.other.length > 0 && (
            <ul>
              {d.other.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          )}
          <h3>Budget</h3>
          <p className="num">
            Before: {budgetLine(d.budget.before)}.<br />
            After: {budgetLine(d.budget.after)}.
          </p>
          {d.invalidatedEvidence.length > 0 && (
            <>
              <h3>Evidence that will need checking again</h3>
              <ul>
                {d.invalidatedEvidence.map((e) => (
                  <li key={e.id}>
                    {e.id}: {e.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {p.newlyViolated.length > 0 && (
        <>
          <h3>Commitments this would break</h3>
          {p.newlyViolated.map((r) => (
            <div key={r.id} className="check violated">
              <StatusBadge status="violated" /> <strong>{r.label}</strong>
              <p>{r.explanation}</p>
              {r.relaxations.length > 0 && (
                <ul>
                  {r.relaxations.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}
      {p.newlyUnresolved.length > 0 && (
        <>
          <h3>New open questions</h3>
          {p.newlyUnresolved.slice(0, 8).map((r) => (
            <div key={r.id} className="check unresolved">
              <StatusBadge status="unresolved" /> <strong>{r.label}</strong>
              <p>{r.explanation}</p>
            </div>
          ))}
          {p.newlyUnresolved.length > 8 && <p className="muted">…and {p.newlyUnresolved.length - 8} more.</p>}
        </>
      )}
      {p.resolved.length > 0 && (
        <p>
          <StatusBadge status="satisfied" /> Resolves: {p.resolved.map((r) => r.label).join(', ')}.
        </p>
      )}
      <div className="actions">
        <button type="button" className="primary" onClick={session.apply} disabled={!p.canApply}>
          Apply changes
        </button>
        <button type="button" onClick={session.keepCurrent}>
          Keep current plan
        </button>
        {p.status === 'stale' && (
          <button type="button" onClick={session.rebuild}>
            Rebuild this change on the latest plan
          </button>
        )}
      </div>
    </section>
  );
}
