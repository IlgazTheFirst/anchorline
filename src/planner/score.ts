import type { CatalogueActivity, CataloguePlace } from '../catalogue/schema';
import { INTERESTS, type Interest, type Profile } from '../domain/schema';

/** Tunable constants, documented in docs/ALGORITHM.md. */
export const PACE = {
  slow: { minNights: 3, changePenalty: 1.2, activitiesPerFullDay: 0.5, extraMax: 2 },
  balanced: { minNights: 2, changePenalty: 0.7, activitiesPerFullDay: 1, extraMax: 1 },
  fast: { minNights: 1, changePenalty: 0.35, activitiesPerFullDay: 1.5, extraMax: 0 },
} as const;

export const WEIGHTS = {
  nightDecay: 0.85,
  transferPerHour: 0.08,
  extraHop: 0.2,
  unknownTransfer: 0.6,
  varietyPerInterest: 0.35,
  wetterMonth: 0.15,
  cautionMonth: 0.2,
  familyBonus: 0.2,
} as const;

export function effectiveWeights(profile: Profile): Record<Interest, number> {
  const w = { ...profile.weights };
  if (profile.alcoholPreference === 'avoid_alcohol_focused') w.nightlife = Math.min(w.nightlife, 1);
  return w;
}

export interface PlaceValue {
  value: number;
  matched: Interest[];
  seasonNote: string | null;
}

/** 0..1 match between a place and the traveller's interest weights, adjusted for season and family. */
export function placeValue(place: CataloguePlace, profile: Profile, month: number): PlaceValue {
  const w = effectiveWeights(profile);
  const total = INTERESTS.reduce((s, i) => s + w[i], 0) || 1;
  let raw = 0;
  for (const i of INTERESTS) raw += w[i] * place.scores[i];
  let value = raw / (3 * total);
  const matched = INTERESTS.filter((i) => w[i] >= 2 && place.scores[i] >= 2).sort((a, b) => w[b] * place.scores[b] - w[a] * place.scores[a] || a.localeCompare(b));
  let seasonNote: string | null = null;
  if (place.seasonGuidance) {
    if (place.seasonGuidance.cautionMonths.includes(month)) {
      value -= WEIGHTS.cautionMonth;
      seasonNote = place.seasonGuidance.note;
    } else if (place.seasonGuidance.wetterMonths.includes(month)) {
      value -= WEIGHTS.wetterMonth;
      seasonNote = place.seasonGuidance.note;
    }
  }
  if (profile.familyFriendly) value += (WEIGHTS.familyBonus * place.familyScore) / 3;
  return { value: Math.max(0.02, value), matched, seasonNote };
}

/** Diminishing returns: the nth night is worth decay^(n-1) of the first. */
export function nightsUtility(value: number, nights: number): number {
  let u = 0;
  for (let j = 0; j < nights; j++) u += value * WEIGHTS.nightDecay ** j;
  return u;
}

/** Rewards covering each interest the traveller rated 2+ somewhere on the trip. */
export function varietyBonus(places: CataloguePlace[], profile: Profile): number {
  const w = effectiveWeights(profile);
  let bonus = 0;
  for (const i of INTERESTS) {
    if (w[i] < 2) continue;
    const best = Math.max(0, ...places.map((p) => p.scores[i]));
    bonus += (WEIGHTS.varietyPerInterest * (best / 3) * w[i]) / 3;
  }
  return bonus;
}

export function activityAllowed(a: CatalogueActivity, profile: Profile): { ok: boolean; why: string | null } {
  if (profile.alcoholPreference === 'avoid_alcohol_focused' && a.alcoholCentred) return { ok: false, why: 'alcohol-focused' };
  if (profile.familyFriendly && !a.familyFriendly) return { ok: false, why: 'not suited to families' };
  if (profile.accessibility.stepFreeNeeded && a.stepFree === 'not_step_free') return { ok: false, why: 'not step-free' };
  if (profile.pace === 'slow' && a.intensity === 'strenuous') return { ok: false, why: 'strenuous for a slow pace' };
  return { ok: true, why: null };
}

export function activityScore(a: CatalogueActivity, profile: Profile): number {
  const w = effectiveWeights(profile);
  const interest = a.tags.reduce((s, t) => s + w[t], 0) / a.tags.length;
  return interest + 0.4 * a.distinctive;
}
