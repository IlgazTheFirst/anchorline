import { tripDocument, type TripDocument } from '../domain/schema';
import { checkIntegrity } from '../domain/integrity';

export interface Snapshot {
  doc: TripDocument;
  label: string;
  at: string;
}

export interface HistoryState {
  undo: Snapshot[];
  redo: Snapshot[];
}

export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export const HISTORY_LIMIT = 50;

export class StaleProposalError extends Error {
  constructor(public currentRevision: number, public baseRevision: number) {
    super(`The plan changed (now revision ${currentRevision}; this change was based on ${baseRevision}). Nothing was saved.`);
    this.name = 'StaleProposalError';
  }
}

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Trip "${id}" was not found.`);
    this.name = 'NotFoundError';
  }
}

export class InvalidDocumentError extends Error {
  constructor(public problems: string[]) {
    super(`The trip could not be saved: ${problems.slice(0, 3).join(' ')}`);
    this.name = 'InvalidDocumentError';
  }
}

export function emptyHistory(): HistoryState {
  return { undo: [], redo: [] };
}

export function historyInfo(h: HistoryState): HistoryInfo {
  return {
    canUndo: h.undo.length > 0,
    canRedo: h.redo.length > 0,
    undoLabel: h.undo[h.undo.length - 1]?.label ?? null,
    redoLabel: h.redo[h.redo.length - 1]?.label ?? null,
  };
}

export function assertValid(doc: TripDocument): TripDocument {
  const parsed = tripDocument.safeParse(doc);
  if (!parsed.success) throw new InvalidDocumentError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const problems = checkIntegrity(parsed.data);
  if (problems.length) throw new InvalidDocumentError(problems);
  return parsed.data;
}

function trim(list: Snapshot[]): Snapshot[] {
  return list.length > HISTORY_LIMIT ? list.slice(list.length - HISTORY_LIMIT) : list;
}

/**
 * Pure state transitions. Repositories call these inside one transaction,
 * so the document and its history always change together or not at all.
 * Undo and redo are new commits with new, higher revisions.
 */
export function commitTransition(current: TripDocument, history: HistoryState, baseRevision: number, next: TripDocument, label: string, now: string) {
  if (current.revision !== baseRevision) throw new StaleProposalError(current.revision, baseRevision);
  const doc = assertValid({ ...next, id: current.id, revision: current.revision + 1, updatedAt: now });
  return { doc, history: { undo: trim([...history.undo, { doc: current, label, at: now }]), redo: [] } };
}

export function undoTransition(current: TripDocument, history: HistoryState, baseRevision: number, now: string) {
  if (current.revision !== baseRevision) throw new StaleProposalError(current.revision, baseRevision);
  const last = history.undo[history.undo.length - 1];
  if (!last) throw new Error('Nothing to undo.');
  const doc = assertValid({ ...last.doc, revision: current.revision + 1, updatedAt: now });
  return { doc, history: { undo: history.undo.slice(0, -1), redo: trim([...history.redo, { doc: current, label: last.label, at: now }]) }, label: last.label };
}

export function redoTransition(current: TripDocument, history: HistoryState, baseRevision: number, now: string) {
  if (current.revision !== baseRevision) throw new StaleProposalError(current.revision, baseRevision);
  const last = history.redo[history.redo.length - 1];
  if (!last) throw new Error('Nothing to redo.');
  const doc = assertValid({ ...last.doc, revision: current.revision + 1, updatedAt: now });
  return { doc, history: { undo: trim([...history.undo, { doc: current, label: last.label, at: now }]), redo: history.redo.slice(0, -1) }, label: last.label };
}
