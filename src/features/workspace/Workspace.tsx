import { useMemo, useState } from 'react';
import type { TripRepository } from '../../application/repository';
import { exportBackup } from '../../application/transfer';
import { evaluateConstraints } from '../../domain/constraints';
import { formatDate, formatZoned } from '../../domain/dates';
import { totalHotelNights } from '../../domain/derive';
import { Badge, Brand, LiveRegion } from '../../ui/components';
import { downloadText, slug } from '../../ui/download';
import { useTripSession } from '../useTripSession';
import { BudgetView } from './BudgetView';
import { ChecksPanel } from './ChecksPanel';
import { CommitmentsPanel } from './CommitmentsPanel';
import { DaysView } from './DaysView';
import { EvidenceView } from './EvidenceView';
import { PlanPanel } from './PlanPanel';
import { PreferencesPanel } from './PreferencesPanel';
import { PreviewPanel } from './PreviewPanel';
import { PrintItinerary } from './PrintItinerary';
import { PrivatePanel } from './PrivatePanel';
import { ShareDialog } from './ShareDialog';
import { StaysView } from './StaysView';
import { SurprisePanel } from './SurprisePanel';
import { TravelView } from './TravelView';

const TABS = ['Stays', 'Days', 'Travel', 'Budget', 'Evidence'] as const;
type Tab = (typeof TABS)[number];

export function Workspace({ repo, tripId, autoGenerate }: { repo: TripRepository; tripId: string; autoGenerate: boolean }) {
  const session = useTripSession(repo, tripId);
  const [tab, setTab] = useState<Tab>('Stays');
  const [shareOpen, setShareOpen] = useState(false);
  const doc = session.doc;
  const results = useMemo(() => (doc ? evaluateConstraints(doc) : []), [doc]);

  if (session.status === 'loading') return <main className="page">Loading…</main>;
  if (session.status === 'missing' || !doc)
    return (
      <main id="main" className="page">
        <p>This trip is not saved in this browser.</p>
        <a href="#/">Back to your trips</a>
      </main>
    );

  const backup = async () => {
    const full = await repo.backup(doc.id);
    downloadText(`${slug(doc.title)}-backup.json`, exportBackup(full?.doc ?? doc, full?.history ?? null));
  };
  const deadline = doc.anchors.find((a) => a.kind === 'arrival_deadline');

  return (
    <>
      <header className="app-header">
        <Brand compact />
        <span className="header-title">
          {doc.title} {doc.isSynthetic && <Badge kind="open">Fictional demo</Badge>} <small className="num">revision {doc.revision}</small>
        </span>
        <div className="toolbar">
          <button type="button" onClick={session.undo} disabled={!session.history?.canUndo} title={session.history?.undoLabel ? `Undo: ${session.history.undoLabel}` : undefined}>
            Undo
          </button>
          <button type="button" onClick={session.redo} disabled={!session.history?.canRedo} title={session.history?.redoLabel ? `Redo: ${session.history.redoLabel}` : undefined}>
            Redo
          </button>
          <button type="button" onClick={backup}>
            Export backup
          </button>
          <button type="button" onClick={() => setShareOpen(true)}>
            Share a copy…
          </button>
          <button type="button" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </header>
      <LiveRegion message={session.message} />
      <main id="main" className="page">
        {doc.isSynthetic && (
          <div className="banner fiction" role="note">
            <strong>Fictional demo.</strong> Every place, event, time and price here is invented to show how the planner works. None of it is travel advice or bookable.
          </div>
        )}
        {session.error && (
          <div className="banner warn" role="alert">
            {session.error}
          </div>
        )}
        {session.changedElsewhere && !session.error && (
          <div className="banner info" role="status">
            This trip was changed in another tab. You are seeing the latest version.
          </div>
        )}
        <div className="workspace screen-only">
          <aside className="summary-col" aria-label="Trip summary">
            <section className="card">
              <h2>Trip</h2>
              <p className="num">
                {doc.window ? `${formatDate(doc.window.firstNight)} → ${formatDate(doc.window.leaveDate)}` : 'No dates yet'} · <strong>{totalHotelNights(doc)} nights planned</strong>
              </p>
              <p className="muted">
                {doc.travellers.count} traveller{doc.travellers.count === 1 ? '' : 's'}, {doc.travellers.rooms} room{doc.travellers.rooms === 1 ? '' : 's'} · leaving {formatDate(doc.departureDate)}
                {deadline && deadline.kind === 'arrival_deadline' ? ` · home by ${formatZoned(deadline.deadline)}` : ''}
              </p>
            </section>
            <ChecksPanel results={results} />
            <CommitmentsPanel session={session} results={results} />
            <PreferencesPanel key={doc.revision} session={session} />
            <PrivatePanel key={`private-${doc.revision}`} session={session} />
          </aside>
          <div>
            <PlanPanel session={session} autoGenerate={autoGenerate} />
            <div className="tabs" role="tablist" aria-label="Trip views">
              {TABS.map((t) => (
                <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </div>
            <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'Stays' && <StaysView session={session} />}
              {tab === 'Days' && <DaysView session={session} />}
              {tab === 'Travel' && <TravelView session={session} />}
              {tab === 'Budget' && <BudgetView session={session} />}
              {tab === 'Evidence' && <EvidenceView session={session} />}
            </section>
          </div>
          <aside aria-label="Changes and suggestions">
            {session.preview ? <PreviewPanel session={session} /> : <SurprisePanel session={session} />}
          </aside>
        </div>
        <PrintItinerary doc={doc} results={results} />
      </main>
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} doc={doc} />
    </>
  );
}
