import type { TripDocument } from '../domain/schema';
import {
  assertValid,
  commitTransition,
  emptyHistory,
  historyInfo,
  NotFoundError,
  redoTransition,
  undoTransition,
  type HistoryState,
} from './history';
import { summarise, type LoadedTrip, type TripRepository, type TripSummary } from './repository';

/** In-memory repository for tests and for browsers without IndexedDB. Not durable. */
export class MemoryTripRepository implements TripRepository {
  readonly durable = false;
  private trips = new Map<string, { doc: TripDocument; history: HistoryState }>();

  constructor(private now: () => string = () => new Date().toISOString()) {}

  async list(): Promise<TripSummary[]> {
    return [...this.trips.values()].map((t) => summarise(t.doc)).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  async get(id: string): Promise<LoadedTrip | null> {
    const t = this.trips.get(id);
    return t ? { doc: structuredClone(t.doc), history: historyInfo(t.history) } : null;
  }

  async create(doc: TripDocument): Promise<TripDocument> {
    if (this.trips.has(doc.id)) throw new Error(`A trip with id "${doc.id}" already exists.`);
    const valid = assertValid({ ...doc, updatedAt: this.now() });
    this.trips.set(valid.id, { doc: structuredClone(valid), history: emptyHistory() });
    return structuredClone(valid);
  }

  async commit(id: string, baseRevision: number, next: TripDocument, label: string): Promise<LoadedTrip> {
    const t = this.trips.get(id);
    if (!t) throw new NotFoundError(id);
    const r = commitTransition(t.doc, t.history, baseRevision, structuredClone(next), label, this.now());
    this.trips.set(id, r);
    return { doc: structuredClone(r.doc), history: historyInfo(r.history) };
  }

  async undo(id: string, baseRevision: number): Promise<LoadedTrip> {
    const t = this.trips.get(id);
    if (!t) throw new NotFoundError(id);
    const r = undoTransition(t.doc, t.history, baseRevision, this.now());
    this.trips.set(id, { doc: r.doc, history: r.history });
    return { doc: structuredClone(r.doc), history: historyInfo(r.history) };
  }

  async redo(id: string, baseRevision: number): Promise<LoadedTrip> {
    const t = this.trips.get(id);
    if (!t) throw new NotFoundError(id);
    const r = redoTransition(t.doc, t.history, baseRevision, this.now());
    this.trips.set(id, { doc: r.doc, history: r.history });
    return { doc: structuredClone(r.doc), history: historyInfo(r.history) };
  }

  async remove(id: string): Promise<void> {
    this.trips.delete(id);
  }

  async backup(id: string) {
    const t = this.trips.get(id);
    return t ? structuredClone(t) : null;
  }
}
