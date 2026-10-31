import type { TripDocument } from './schema';

/**
 * Referential checks Zod cannot express. Booking marks and evidence may point
 * at removed items on purpose (they are flagged, not deleted); structural
 * references between places, stays, legs, activities and anchors must hold.
 */
export function checkIntegrity(doc: TripDocument): string[] {
  const errors: string[] = [];
  const dupes = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`Duplicate ${label} id "${id}".`);
      seen.add(id);
    }
  };
  dupes('place', doc.places.map((p) => p.id));
  dupes('stay', doc.stays.map((s) => s.id));
  dupes('travel leg', doc.travelLegs.map((l) => l.id));
  dupes('activity', doc.activities.map((a) => a.id));
  dupes('anchor', doc.anchors.map((a) => a.id));
  dupes('claim', doc.claims.map((c) => c.id));
  dupes('budget item', doc.budgetItems.map((b) => b.id));
  dupes('booking mark', doc.bookingMarks.map((b) => b.id));

  const places = new Set(doc.places.map((p) => p.id));
  const activities = new Set(doc.activities.map((a) => a.id));
  const claims = new Set(doc.claims.map((c) => c.id));
  const need = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };
  need(places.has(doc.homePlaceId), `Home place "${doc.homePlaceId}" is not defined.`);
  for (const s of doc.stays) need(places.has(s.placeId), `Stay "${s.id}" refers to unknown place "${s.placeId}".`);
  for (const l of doc.travelLegs) {
    need(places.has(l.fromPlaceId), `Travel leg "${l.id}" starts at unknown place "${l.fromPlaceId}".`);
    need(places.has(l.toPlaceId), `Travel leg "${l.id}" ends at unknown place "${l.toPlaceId}".`);
    for (const e of l.evidenceIds) need(claims.has(e), `Travel leg "${l.id}" cites unknown evidence "${e}".`);
    if (l.durationRangeMinutes) need(l.durationRangeMinutes.min <= l.durationRangeMinutes.max, `Travel leg "${l.id}" has a duration range that runs backwards.`);
  }
  for (const a of doc.activities) {
    need(places.has(a.placeId), `Activity "${a.id}" refers to unknown place "${a.placeId}".`);
    for (const e of a.evidenceIds ?? []) need(claims.has(e), `Activity "${a.id}" cites unknown evidence "${e}".`);
  }
  for (const an of doc.anchors) {
    if (an.kind === 'fixed_event') need(activities.has(an.activityId), `Anchor "${an.id}" refers to unknown activity "${an.activityId}".`);
    if ('placeId' in an) need(places.has(an.placeId), `Anchor "${an.id}" refers to unknown place "${an.placeId}".`);
  }
  for (const b of doc.budgetItems) {
    for (const e of b.evidenceIds ?? []) need(claims.has(e), `Budget item "${b.id}" cites unknown evidence "${e}".`);
    if (b.unitAmountMaxMinor != null && b.unitAmountMinor != null) need(b.unitAmountMaxMinor >= b.unitAmountMinor, `Budget item "${b.id}" has a range that runs backwards.`);
  }
  if (doc.window) {
    if (doc.window.firstNight >= doc.window.leaveDate) errors.push('The first night must be before the day you leave.');
    if (doc.window.firstNight < doc.departureDate) errors.push('The first night cannot be before you leave home.');
  }
  return errors;
}
