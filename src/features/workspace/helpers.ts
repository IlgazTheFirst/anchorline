import { DEFAULT_PACK } from '../../catalogue';
import type { TripDocument } from '../../domain/schema';

export function placeName(doc: TripDocument, id: string): string {
  return doc.places.find((p) => p.id === id)?.name ?? DEFAULT_PACK.places.find((p) => p.id === id)?.name ?? id;
}

export function placeZone(doc: TripDocument, id: string): string {
  return doc.places.find((p) => p.id === id)?.timeZone ?? DEFAULT_PACK.places.find((p) => p.id === id)?.timeZone ?? 'UTC';
}

export const PART_ORDER = ['morning', 'afternoon', 'evening', 'night', 'any'];


export { customPlaceId } from '../../domain/places';
