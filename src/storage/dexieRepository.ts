import Dexie, { type Table } from 'dexie';
import {
  assertValid,
  commitTransition,
  emptyHistory,
  historyInfo,
  NotFoundError,
  redoTransition,
  undoTransition,
  type HistoryState,
} from '../application/history';
import { summarise, type LoadedTrip, type TripRepository, type TripSummary } from '../application/repository';
import type { TripDocument } from '../domain/schema';

interface StoredTrip {
  id: string;
  updatedAt: string;
  doc: TripDocument;
}

interface StoredHistory extends HistoryState {
  tripId: string;
}

export class HolidayDatabase extends Dexie {
  trips!: Table<StoredTrip, string>;
  history!: Table<StoredHistory, string>;

  constructor(name = 'holiday-planner') {
    super(name);
    // Version 1. Add new versions with .upgrade() migrations; never edit this one.
    this.version(1).stores({ trips: 'id, updatedAt', history: 'tripId' });
  }
}

export interface DexieRepositoryOptions {
  now?: () => string;
  /** Test hook: runs inside the write transaction after the trip is written. */
  afterTripWrite?: () => void | Promise<void>;
}

/**
 * IndexedDB repository. Each commit, undo and redo reads the current
 * revision, compares it to the caller's base revision and writes the next
 * document plus its history in one read/write transaction. A mismatch or
 * any failure aborts the whole transaction.
 */
export class DexieTripRepository implements TripRepository {
  readonly durable = true;
  private now: () => string;

  constructor(private db: HolidayDatabase = new HolidayDatabase(), private options: DexieRepositoryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async list(): Promise<TripSummary[]> {
    const rows = await this.db.trips.orderBy('updatedAt').reverse().toArray();
    return rows.map((r) => summarise(r.doc));
  }

  async get(id: string): Promise<LoadedTrip | null> {
    return this.db.transaction('r', this.db.trips, this.db.history, async () => {
      const row = await this.db.trips.get(id);
      if (!row) return null;
      const h = (await this.db.history.get(id)) ?? { tripId: id, ...emptyHistory() };
      return { doc: row.doc, history: historyInfo(h) };
    });
  }

  async create(doc: TripDocument): Promise<TripDocument> {
    const valid = assertValid({ ...doc, updatedAt: this.now() });
    await this.db.transaction('rw', this.db.trips, this.db.history, async () => {
      if (await this.db.trips.get(valid.id)) throw new Error(`A trip with id "${valid.id}" already exists.`);
      await this.db.trips.add({ id: valid.id, updatedAt: valid.updatedAt!, doc: valid });
      await this.db.history.put({ tripId: valid.id, ...emptyHistory() });
    });
    return valid;
  }

  private async transition(
    id: string,
    step: (doc: TripDocument, h: HistoryState) => { doc: TripDocument; history: HistoryState },
  ): Promise<LoadedTrip> {
    return this.db.transaction('rw', this.db.trips, this.db.history, async () => {
      const row = await this.db.trips.get(id);
      if (!row) throw new NotFoundError(id);
      const h = (await this.db.history.get(id)) ?? { tripId: id, ...emptyHistory() };
      const r = step(row.doc, { undo: h.undo, redo: h.redo });
      await this.db.trips.put({ id, updatedAt: r.doc.updatedAt ?? this.now(), doc: r.doc });
      if (this.options.afterTripWrite) await this.options.afterTripWrite();
      await this.db.history.put({ tripId: id, ...r.history });
      return { doc: r.doc, history: historyInfo(r.history) };
    });
  }

  commit(id: string, baseRevision: number, next: TripDocument, label: string): Promise<LoadedTrip> {
    return this.transition(id, (doc, h) => commitTransition(doc, h, baseRevision, next, label, this.now()));
  }

  undo(id: string, baseRevision: number): Promise<LoadedTrip> {
    return this.transition(id, (doc, h) => undoTransition(doc, h, baseRevision, this.now()));
  }

  redo(id: string, baseRevision: number): Promise<LoadedTrip> {
    return this.transition(id, (doc, h) => redoTransition(doc, h, baseRevision, this.now()));
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.trips, this.db.history, async () => {
      await this.db.trips.delete(id);
      await this.db.history.delete(id);
    });
  }

  async backup(id: string) {
    return this.db.transaction('r', this.db.trips, this.db.history, async () => {
      const row = await this.db.trips.get(id);
      if (!row) return null;
      const h = (await this.db.history.get(id)) ?? { tripId: id, ...emptyHistory() };
      return { doc: row.doc, history: { undo: h.undo, redo: h.redo } };
    });
  }
}
