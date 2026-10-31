import { localDateOf } from './dates';
import type { BudgetItem, Claim, TripDocument } from './schema';

export type Scope = NonNullable<Claim['dependsOn']>;

export interface Applicability {
  applicable: boolean;
  reason: string | null;
}

/** The current scope of a stay, leg or activity: what a quote or schedule would depend on. */
export function scopeOf(doc: TripDocument, subjectId: string): Scope | null {
  const stay = doc.stays.find((s) => s.id === subjectId);
  if (stay) return { placeId: stay.placeId, checkIn: stay.checkIn, checkOutExclusive: stay.checkOutExclusive, travellerCount: doc.travellers.count };
  const leg = doc.travelLegs.find((l) => l.id === subjectId);
  if (leg) {
    const scope: Scope = { fromPlaceId: leg.fromPlaceId, toPlaceId: leg.toPlaceId, travellerCount: doc.travellers.count };
    if (leg.departure) scope.departureLocalDate = localDateOf(leg.departure);
    return scope;
  }
  const activity = doc.activities.find((a) => a.id === subjectId);
  if (activity) return { placeId: activity.placeId, travellerCount: doc.travellers.count };
  const place = doc.places.find((p) => p.id === subjectId);
  if (place) return { placeId: place.id };
  return null;
}

const LABELS: Record<keyof Scope, string> = {
  placeId: 'place',
  fromPlaceId: 'origin',
  toPlaceId: 'destination',
  departureLocalDate: 'travel date',
  checkIn: 'check-in date',
  checkOutExclusive: 'check-out date',
  travellerCount: 'number of travellers',
};

/**
 * Evidence applies only while every input it depended on still matches.
 * Replacing a city or moving a date makes the old quote or timetable
 * inapplicable instead of silently carrying it over.
 */
export function compareScope(dependsOn: Scope | undefined, current: Scope | null, subjectExists: boolean): Applicability {
  if (!subjectExists) return { applicable: false, reason: 'The item it described has been removed from the plan.' };
  if (!dependsOn) return { applicable: true, reason: null };
  if (!current) return { applicable: false, reason: 'The item it described has been removed from the plan.' };
  const changed: string[] = [];
  for (const key of Object.keys(dependsOn) as Array<keyof Scope>) {
    const expected = dependsOn[key];
    if (expected === undefined) continue;
    if (current[key] !== expected) changed.push(LABELS[key]);
  }
  if (changed.length) return { applicable: false, reason: `Checked for a different ${changed.join(', ')}.` };
  return { applicable: true, reason: null };
}

function subjectExists(doc: TripDocument, subjectId: string | null): boolean {
  if (!subjectId) return true;
  return (
    doc.stays.some((s) => s.id === subjectId) ||
    doc.travelLegs.some((l) => l.id === subjectId) ||
    doc.activities.some((a) => a.id === subjectId) ||
    doc.places.some((p) => p.id === subjectId)
  );
}

export function claimApplicability(doc: TripDocument, claim: Claim): Applicability {
  return compareScope(claim.dependsOn, scopeOf(doc, claim.subjectId), subjectExists(doc, claim.subjectId));
}

export function budgetItemApplicability(doc: TripDocument, item: BudgetItem): Applicability {
  if (!item.subjectId) return { applicable: true, reason: null };
  return compareScope(item.dependsOn, scopeOf(doc, item.subjectId), subjectExists(doc, item.subjectId));
}

export function inapplicableClaimIds(doc: TripDocument): string[] {
  return doc.claims.filter((c) => !claimApplicability(doc, c).applicable).map((c) => c.id);
}

export const EVIDENCE_LABELS: Record<Claim['evidenceStatus'], string> = {
  synthetic: 'Fictional (demo only)',
  planning_assumption: 'Planning assumption',
  source_documented: 'Documented by a source',
  dated_schedule: 'Dated timetable checked',
  live_quote: 'Price quoted',
  user_recorded: 'Recorded by you',
};
