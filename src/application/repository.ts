import type { TripDocument } from '../domain/schema';
import type { HistoryInfo, HistoryState } from './history';

export interface TripSummary {
  id: string;
  title: string;
  revision: number;
  isSynthetic: boolean;
  updatedAt: string | null;
  firstNight: string | null;
  leaveDate: string | null;
}

export interface LoadedTrip {
  doc: TripDocument;
  history: HistoryInfo;
}

/** Storage boundary. Implementations must make commit/undo/redo atomic. */
export interface TripRepository {
  readonly durable: boolean;
  list(): Promise<TripSummary[]>;
  get(id: string): Promise<LoadedTrip | null>;
  create(doc: TripDocument): Promise<TripDocument>;
  commit(id: string, baseRevision: number, next: TripDocument, label: string): Promise<LoadedTrip>;
  undo(id: string, baseRevision: number): Promise<LoadedTrip>;
  redo(id: string, baseRevision: number): Promise<LoadedTrip>;
  remove(id: string): Promise<void>;
  backup(id: string): Promise<{ doc: TripDocument; history: HistoryState } | null>;
}

export function summarise(doc: TripDocument): TripSummary {
  return {
    id: doc.id,
    title: doc.title,
    revision: doc.revision,
    isSynthetic: doc.isSynthetic,
    updatedAt: doc.updatedAt ?? null,
    firstNight: doc.window?.firstNight ?? null,
    leaveDate: doc.window?.leaveDate ?? null,
  };
}
