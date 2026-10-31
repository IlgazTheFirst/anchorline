import { useCallback, useEffect, useRef, useState } from 'react';
import { StaleProposalError, type HistoryInfo } from '../application/history';
import { makeProposal, previewProposal, type PreviewResult } from '../application/proposal';
import type { TripRepository } from '../application/repository';
import type { Actor, Command } from '../domain/commands';
import type { TripDocument } from '../domain/schema';

const CHANNEL = 'anchorline-changes';

interface Session {
  doc: TripDocument | null;
  history: HistoryInfo | null;
  status: 'loading' | 'ready' | 'missing';
  preview: PreviewResult | null;
  message: string;
  error: string | null;
  changedElsewhere: boolean;
}

/**
 * One open trip: its accepted document, history availability and the change
 * being previewed. Every edit goes propose → preview → apply. Other tabs are
 * told about commits so a stale preview is caught before and at commit time.
 */
export function useTripSession(repo: TripRepository, tripId: string) {
  const [s, setS] = useState<Session>({ doc: null, history: null, status: 'loading', preview: null, message: '', error: null, changedElsewhere: false });
  const channel = useRef<BroadcastChannel | null>(null);
  const lastCommands = useRef<{ label: string; commands: Command[]; actor: Actor; rationale?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await repo.get(tripId);
      setS((prev) => {
        if (!loaded) return { ...prev, status: 'missing', doc: null };
        const preview = prev.preview && prev.preview.proposal ? previewProposal(loaded.doc, prev.preview.proposal) : prev.preview;
        return { ...prev, status: 'ready', doc: loaded.doc, history: loaded.history, preview };
      });
    } catch (err) {
      setS((prev) => ({ ...prev, status: 'ready', error: `Could not read the trip from this browser's storage: ${(err as Error).message}` }));
    }
  }, [repo, tripId]);

  useEffect(() => {
    void load();
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<{ tripId: string; revision: number }>) => {
      if (e.data?.tripId !== tripId) return;
      setS((prev) => (prev.doc && e.data.revision > prev.doc.revision ? { ...prev, changedElsewhere: true, message: 'This trip was changed in another tab. Showing the latest version.' } : prev));
      void load();
    };
    return () => ch.close();
  }, [load, tripId]);

  const announce = (doc: TripDocument) => channel.current?.postMessage({ tripId: doc.id, revision: doc.revision });

  const propose = useCallback(
    (label: string, commands: Command[], actor: Actor = 'user', rationale?: string) => {
      setS((prev) => {
        if (!prev.doc) return prev;
        lastCommands.current = { label, commands, actor, rationale };
        const preview = previewProposal(prev.doc, makeProposal(prev.doc, label, commands, actor, rationale));
        return { ...prev, preview, message: `Previewing: ${label}`, error: null };
      });
    },
    [],
  );

  const rebuild = useCallback(() => {
    const last = lastCommands.current;
    if (last) propose(last.label, last.commands, last.actor, last.rationale);
  }, [propose]);

  const keepCurrent = useCallback(() => setS((prev) => ({ ...prev, preview: null, message: 'Kept the current plan. Nothing changed.' })), []);

  const apply = useCallback(async () => {
    const current = s;
    const p = current.preview;
    if (!current.doc || !p?.canApply || !p.next || !p.proposal) return;
    try {
      const r = await repo.commit(current.doc.id, p.proposal.baseRevision, p.next, p.proposal.label);
      announce(r.doc);
      setS((prev) => ({ ...prev, doc: r.doc, history: r.history, preview: null, changedElsewhere: false, message: `Applied: ${p.proposal!.label}. Now at revision ${r.doc.revision}.`, error: null }));
    } catch (err) {
      if (err instanceof StaleProposalError) {
        const loaded = await repo.get(current.doc.id);
        setS((prev) => ({
          ...prev,
          doc: loaded?.doc ?? prev.doc,
          history: loaded?.history ?? prev.history,
          preview: loaded && prev.preview?.proposal ? previewProposal(loaded.doc, prev.preview.proposal) : prev.preview,
          error: 'Conflict: this trip changed in another tab before your change was saved. Nothing was overwritten. Review the latest plan and rebuild your change.',
        }));
      } else {
        setS((prev) => ({ ...prev, error: `Save failed: ${(err as Error).message}. Your last saved plan is unchanged.` }));
      }
    }
  }, [repo, s]);

  const step = useCallback(
    async (kind: 'undo' | 'redo') => {
      const doc = s.doc;
      if (!doc) return;
      try {
        const r = kind === 'undo' ? await repo.undo(doc.id, doc.revision) : await repo.redo(doc.id, doc.revision);
        announce(r.doc);
        setS((prev) => ({ ...prev, doc: r.doc, history: r.history, preview: null, message: `${kind === 'undo' ? 'Undone' : 'Redone'}. Now at revision ${r.doc.revision}.`, error: null }));
      } catch (err) {
        if (err instanceof StaleProposalError) {
          await load();
          setS((prev) => ({ ...prev, error: 'Conflict: the trip changed in another tab. Showing the latest version; nothing was overwritten.' }));
        } else setS((prev) => ({ ...prev, error: (err as Error).message }));
      }
    },
    [repo, s.doc, load],
  );

  return { ...s, propose, apply, keepCurrent, rebuild, undo: () => step('undo'), redo: () => step('redo'), reload: load };
}

export type TripSession = ReturnType<typeof useTripSession>;
