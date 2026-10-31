import type { TripDocument } from './schema';

/**
 * A stable id for a custom place. Reuses an existing place with the same
 * name and time zone; otherwise picks an unused id, so two different places
 * with the same name never collide.
 */
export function customPlaceId(doc: Pick<TripDocument, 'places'>, name: string, timeZone: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'place';
  const same = doc.places.find((p) => !p.catalogueId && p.name.trim().toLowerCase() === name.trim().toLowerCase() && p.timeZone === timeZone);
  if (same) return same.id;
  let id = `custom_${slug}`;
  for (let n = 2; doc.places.some((p) => p.id === id); n++) id = `custom_${slug}_${n}`;
  return id;
}
