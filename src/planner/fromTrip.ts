import type { DestinationPack } from '../catalogue/schema';
import { addDays, compareDates, dateInZone, localDateOf, resolveZoned } from '../domain/dates';
import type { Command } from '../domain/commands';
import type { TripDocument } from '../domain/schema';
import { generatePlan, type PlanOptions } from './generate';
import type { Pin, PlanRequest, PlanResult } from './types';

export type RequestResult = { ok: true; request: PlanRequest } | { ok: false; problems: string[] };

/**
 * Turns the trip's own commitments into planner inputs. Hard anchors and
 * locks become pins and minimums; nothing is dropped or relaxed here.
 */
export function buildPlanRequest(doc: TripDocument, pack: DestinationPack): RequestResult {
  const problems: string[] = [];
  if (!doc.window) problems.push('Add your first night and the day you leave before generating a plan.');
  const home = doc.places.find((p) => p.id === doc.homePlaceId);
  if (!home) problems.push('The trip has no home place.');
  if (problems.length || !doc.window || !home) return { ok: false, problems };
  const catalogueIds = new Set(pack.places.map((p) => p.id));
  const toPlanId = (placeId: string) => {
    const place = doc.places.find((p) => p.id === placeId);
    return place?.catalogueId && catalogueIds.has(place.catalogueId) ? place.catalogueId : placeId;
  };
  const pins: Pin[] = [];
  const requiredPlaceIds: string[] = [];
  const excludedPlaceIds: string[] = [];
  const minNights: Record<string, number> = {};
  const consecutive: PlanRequest['consecutive'] = [];
  const fullDays: PlanRequest['fullDays'] = [];
  let homeDeadlineDate: string | null = null;

  for (const a of doc.anchors) {
    if (a.strength !== 'hard') continue;
    switch (a.kind) {
      case 'required_place':
        requiredPlaceIds.push(toPlanId(a.placeId));
        break;
      case 'excluded_place':
        excludedPlaceIds.push(toPlanId(a.placeId));
        break;
      case 'minimum_nights_at_place': {
        const id = toPlanId(a.placeId);
        requiredPlaceIds.push(id);
        minNights[id] = Math.max(minNights[id] ?? 0, a.minimumNights);
        break;
      }
      case 'minimum_consecutive_nights':
        consecutive.push({ tag: a.qualifyingTag, minimumNights: a.minimumNights, anchorId: a.id });
        break;
      case 'minimum_full_days':
        fullDays.push({ tag: a.qualifyingTag, minimumDays: a.minimumDays, anchorId: a.id });
        break;
      case 'arrival_deadline':
        homeDeadlineDate = localDateOf(a.deadline);
        break;
      case 'fixed_event': {
        const act = doc.activities.find((x) => x.id === a.activityId);
        if (!act?.start || !act.end) {
          problems.push(`${act?.title ?? 'A fixed event'} needs a start and end time before planning.`);
          break;
        }
        const place = doc.places.find((p) => p.id === act.placeId);
        const s = resolveZoned(act.start);
        const e = resolveZoned(act.end);
        if (s.status !== 'ok' || e.status !== 'ok' || !place) {
          problems.push(`${act.title}: resolve its times first.`);
          break;
        }
        const startDate = dateInZone(s.instant.subtract({ minutes: a.arrivalBufferMinutes ?? 0 }), place.timeZone);
        const endDate = dateInZone(e.instant, place.timeZone);
        const firstNight = compareDates(addDays(startDate, -1), doc.window.firstNight) >= 0 ? addDays(startDate, -1) : startDate;
        pins.push({ placeId: toPlanId(act.placeId), firstNight, lastNight: endDate, exact: false, reason: act.title, sourceId: a.id });
        break;
      }
      case 'protected_rest': {
        const place = doc.places.find((p) => p.id === a.placeId);
        const s = resolveZoned(a.start);
        const e = resolveZoned(a.end);
        if (s.status !== 'ok' || e.status !== 'ok' || !place) {
          problems.push(`${a.label ?? 'A protected rest period'}: resolve its times first.`);
          break;
        }
        pins.push({ placeId: toPlanId(a.placeId), firstNight: dateInZone(s.instant, place.timeZone), lastNight: dateInZone(e.instant, place.timeZone), exact: false, reason: a.label ?? 'protected rest', sourceId: a.id });
        break;
      }
    }
  }
  const customPlaces = doc.places.filter((p) => p.id !== doc.homePlaceId && !(p.catalogueId && catalogueIds.has(p.catalogueId)) && !catalogueIds.has(p.id));
  const customIds = new Set(customPlaces.map((p) => p.id));
  // The planner knows nothing about the traveller's own places, so stays there keep their dates.
  for (const s of doc.stays) {
    if (s.lockedFields.length || !customIds.has(s.placeId)) continue;
    const name = customPlaces.find((p) => p.id === s.placeId)!.name;
    pins.push({ placeId: s.placeId, firstNight: s.checkIn, lastNight: addDays(s.checkOutExclusive, -1), exact: true, reason: `your own stay in ${name}`, sourceId: s.id });
  }
  const lockedStays = doc.stays.filter((s) => s.lockedFields.length > 0 || customIds.has(s.placeId));
  for (const s of lockedStays.filter((x) => x.lockedFields.length > 0)) {
    const id = toPlanId(s.placeId);
    if (s.lockedFields.includes('checkIn') || s.lockedFields.includes('checkOutExclusive')) {
      pins.push({ placeId: id, firstNight: s.checkIn, lastNight: addDays(s.checkOutExclusive, -1), exact: true, reason: `your locked stay`, sourceId: s.id });
    } else requiredPlaceIds.push(id);
  }
  if (problems.length) return { ok: false, problems };
  const isKept = (a: TripDocument['activities'][number]) => a.lockedFields.length > 0 || doc.anchors.some((an) => an.kind === 'fixed_event' && an.activityId === a.id);
  const keptActivities = doc.activities.filter(isKept);
  const userActivities = doc.activities.filter((a) => !isKept(a) && a.dataKind === 'user');
  return {
    ok: true,
    request: {
      pack,
      firstNight: doc.window.firstNight,
      leaveDate: doc.window.leaveDate,
      departureDate: doc.departureDate,
      home,
      profile: doc.profile,
      travellers: doc.travellers.count,
      requiredPlaceIds: [...new Set(requiredPlaceIds)],
      excludedPlaceIds: [...new Set(excludedPlaceIds)],
      minNights,
      pins,
      consecutive,
      fullDays,
      arrivalGatewayId: doc.window.arrivalGatewayId ?? null,
      departureGatewayId: doc.window.departureGatewayId ?? null,
      customPlaces,
      lockedStays,
      lockedLegs: doc.travelLegs.filter((l) => (l.lockedFields ?? []).length > 0),
      keptActivities,
      userActivities,
      homeDeadlineDate,
    },
  };
}

export function planForTrip(doc: TripDocument, pack: DestinationPack, options: PlanOptions = {}): { result: PlanResult | null; problems: string[] } {
  const built = buildPlanRequest(doc, pack);
  if (!built.ok) return { result: null, problems: built.problems };
  return { result: generatePlan(built.request, options), problems: [] };
}

/** The planner's output enters the trip only through the normal command pipeline. */
export function planToCommands(result: PlanResult): Command[] {
  return [
    {
      type: 'SetItinerary',
      places: result.places,
      stays: result.stays,
      travelLegs: result.travelLegs,
      activities: result.activities,
      claims: result.claims,
      catalogue: { packId: result.coverage.packId, version: result.coverage.version },
      planExplanation: {
        summary: result.summary,
        reasons: [...result.reasons, ...result.stops.map((s) => `${result.places.find((p) => p.id === s.placeId)?.name ?? s.placeId}: ${s.reasons.join(' ')}`)].slice(0, 100),
        unresolved: result.unresolved.slice(0, 100),
      },
    },
  ];
}
