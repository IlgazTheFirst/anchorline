import type { CatalogueActivity, CataloguePlace, DestinationPack, RouteOption } from '../catalogue/schema';
import type { Command } from '../domain/commands';
import { addDays, dateInZone, datesInRange, dayOfWeek, formatDate, formatMinutes, localDateOf, resolveZoned } from '../domain/dates';
import { dayCards, recoveryMornings, type DayCard } from '../domain/derive';
import type { Activity, Claim, PartOfDay, TripDocument } from '../domain/schema';
import { activityAllowed, effectiveWeights } from './score';

export interface Surprise {
  key: string;
  title: string;
  placeName: string;
  date: string;
  partOfDay: PartOfDay;
  reason: string;
  timeNote: string;
  budgetNote: string;
  sourceUrl: string;
  commands: Command[];
}

export const MAX_SURPRISES = 3;
/** Day trips only use non-flight connections of at most this many minutes each way. */
export const DAY_TRIP_MAX_MINUTES = 150;

interface Candidate {
  activity: CatalogueActivity;
  base: CataloguePlace;
  basePlaceId: string;
  stayId: string;
  trip: { place: CataloguePlace; route: RouteOption } | null;
}

/**
 * Up to three optional experiences that fit the traveller's interests. Each
 * sits on a genuinely free day: no fixed event, no protected rest, at least
 * one part of the day still free afterwards, and no morning plans after a
 * late night when recovery time is protected. Day-of-week schedules are
 * respected. Besides things to do where you stay, it considers day trips to
 * catalogue places within a short, non-flight hop. `round` rotates
 * deterministically through further ideas. Each one is a proposal only.
 */
export function suggestSurprises(doc: TripDocument, pack: DestinationPack, round = 0): Surprise[] {
  const weights = effectiveWeights(doc.profile);
  const inPlan = new Set(doc.activities.map((a) => a.catalogueActivityId).filter(Boolean));
  const coveredTags = new Set(doc.activities.flatMap((a) => a.tags));
  const cards = dayCards(doc);
  const lateMornings = recoveryMornings(doc);
  const busy = new Set<string>();
  for (const an of doc.anchors) {
    if (an.kind === 'protected_rest') {
      const s = resolveZoned(an.start);
      const e = resolveZoned(an.end);
      const place = doc.places.find((p) => p.id === an.placeId);
      if (s.status === 'ok' && e.status === 'ok' && place) {
        for (const d of datesInRange(dateInZone(s.instant, place.timeZone), addDays(dateInZone(e.instant, place.timeZone), 1))) busy.add(d);
      }
    }
    if (an.kind === 'fixed_event') {
      const act = doc.activities.find((a) => a.id === an.activityId);
      if (act?.start) busy.add(localDateOf(act.start));
      if (act?.end) busy.add(localDateOf(act.end));
    }
  }
  const plannedPlaces = new Set(doc.stays.map((s) => doc.places.find((p) => p.id === s.placeId)?.catalogueId ?? s.placeId));

  const candidates: Candidate[] = [];
  for (const stay of doc.stays) {
    const place = doc.places.find((p) => p.id === stay.placeId);
    const base = pack.places.find((p) => p.id === (place?.catalogueId ?? stay.placeId));
    if (!place || !base) continue;
    for (const a of pack.activities) {
      if (a.placeId === base.id) candidates.push({ activity: a, base, basePlaceId: place.id, stayId: stay.id, trip: null });
    }
    for (const route of pack.routes) {
      if (route.from !== base.id && route.to !== base.id) continue;
      if (route.mode.includes('flight') || route.durationMinutes.max > DAY_TRIP_MAX_MINUTES) continue;
      const other = pack.places.find((p) => p.id === (route.from === base.id ? route.to : route.from));
      if (!other || plannedPlaces.has(other.id)) continue;
      for (const a of pack.activities) {
        if (a.placeId === other.id && a.partOfDay !== 'night') candidates.push({ activity: a, base, basePlaceId: place.id, stayId: stay.id, trip: { place: other, route } });
      }
    }
  }

  const options: Array<Surprise & { score: number }> = [];
  for (const c of candidates) {
    const a = c.activity;
    if (inPlan.has(a.id) || a.recurrence || !activityAllowed(a, doc.profile).ok) continue;
    const interest = a.tags.reduce((s, t) => s + weights[t], 0) / a.tags.length;
    if (interest < 1.5) continue;
    const fullDay = Boolean(c.trip) || (a.partOfDay === 'any' && a.durationHours.min >= 6);
    // At least two free parts now, so one stays free after the surprise.
    const freeDays = cards.filter((d) => d.stayId === c.stayId && d.isFullDay && !busy.has(d.date) && d.freeParts.length >= 2 && !d.legs.length);
    const slotFor = (d: DayCard): PartOfDay | null => {
      const free = d.freeParts.filter((p) => !(p === 'morning' && lateMornings.has(d.date)));
      if (fullDay) return d.activities.length === 0 && !lateMornings.has(d.date) ? 'any' : null;
      const wanted = a.partOfDay === 'night' ? 'evening' : a.partOfDay;
      if (wanted === 'any') return (free[0] as PartOfDay | undefined) ?? null;
      return free.includes(wanted) ? wanted : null;
    };
    const day = freeDays.find((d) => (!a.daysOfWeek || a.daysOfWeek.includes(dayOfWeek(d.date))) && slotFor(d) !== null);
    if (!day) continue;
    const part = slotFor(day)!;
    const novel = a.tags.filter((t) => !coveredTags.has(t));
    const score = a.distinctive + interest * 0.6 + novel.length * 0.8 + (c.trip ? 0.3 : 0);
    const id = `surprise_${a.id}_${day.date}`;
    const claimId = `claim_${id}`;
    const routeClaimId = `claim_${id}_route`;
    const title = c.trip ? `Day trip to ${c.trip.place.name}: ${a.title}` : a.title;
    const claims: Claim[] = [
      { id: claimId, subjectId: id, kind: 'activity_info', evidenceStatus: 'source_documented', sourceUrl: a.sourceUrls[0]!, checkedAt: a.checkedAt, dataKind: 'curated', dependsOn: { placeId: c.basePlaceId }, note: a.summary },
    ];
    if (c.trip) {
      claims.push({
        id: routeClaimId,
        subjectId: id,
        kind: 'route_existence',
        evidenceStatus: 'source_documented',
        sourceUrl: c.trip.route.sourceUrls[0]!,
        checkedAt: c.trip.route.checkedAt,
        dataKind: 'curated',
        dependsOn: { placeId: c.basePlaceId },
        note: `${c.trip.route.mode} between ${c.base.name} and ${c.trip.place.name}: about ${formatMinutes(c.trip.route.durationMinutes.min)}–${formatMinutes(c.trip.route.durationMinutes.max)} each way (planning estimate, not a timetable).`,
      });
    }
    const activity: Activity = {
      id,
      placeId: c.basePlaceId,
      title,
      start: null,
      end: null,
      date: day.date,
      partOfDay: a.partOfDay === 'night' ? 'night' : part,
      durationMinutes: { min: Math.round(a.durationHours.min * 60), max: Math.round(a.durationHours.max * 60) },
      daysOfWeek: a.daysOfWeek ? [...a.daysOfWeek] : null,
      tags: [...a.tags],
      lockedFields: [],
      dataKind: 'curated',
      catalogueActivityId: a.id,
      evidenceIds: claims.map((x) => x.id),
      note: c.trip ? `Day trip from ${c.base.name} by ${c.trip.route.mode}.` : null,
    };
    const why = novel.length ? `Adds ${novel.join(' and ')}, which your plan does not have yet` : `Matches your interest in ${a.tags.join(' and ')}`;
    const travel = c.trip ? ` Travel: ${c.trip.route.mode}, about ${formatMinutes(c.trip.route.durationMinutes.min)}–${formatMinutes(c.trip.route.durationMinutes.max)} each way (planning estimate).` : '';
    options.push({
      key: id,
      title,
      placeName: c.trip ? `${c.trip.place.name}, from ${c.base.name}` : c.base.name,
      date: day.date,
      partOfDay: part,
      reason: `${why}, on a free day in ${c.base.name} (${formatDate(day.date)}). ${a.summary}`,
      timeNote: `${part === 'any' ? 'Most of the day' : part[0]!.toUpperCase() + part.slice(1)}, about ${a.durationHours.min}–${a.durationHours.max} h.${travel}${a.schedulingNote ? ` ${a.schedulingNote}` : ''}`,
      budgetNote: 'No price data in the catalogue. The cost stays unknown until you add one.',
      sourceUrl: a.sourceUrls[0]!,
      score,
      commands: [...claims.map((claim) => ({ type: 'AddClaim' as const, claim })), { type: 'AddActivity', activity }],
    });
  }
  options.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));
  const unique: typeof options = [];
  const usedDates = new Set<string>();
  const usedActivities = new Set<string>();
  for (const o of options) {
    const actId = o.key.slice('surprise_'.length, o.key.length - 11);
    if (usedDates.has(o.date) || usedActivities.has(actId)) continue;
    usedDates.add(o.date);
    usedActivities.add(actId);
    unique.push(o);
  }
  if (!unique.length) return [];
  const start = (round * MAX_SURPRISES) % unique.length;
  const rotated = [...unique.slice(start), ...unique.slice(0, start)].slice(0, MAX_SURPRISES);
  return rotated.map(({ score: _score, ...s }) => s);
}
