import {
  addDays,
  compareDates,
  datesInRange,
  instantOf,
  localDateOf,
  nightsBetween,
  type Temporal,
} from './dates';
import type { Activity, Place, Stay, TravelLeg, TripDocument } from './schema';

export function placeMap(doc: Pick<TripDocument, 'places'>): Map<string, Place> {
  return new Map(doc.places.map((p) => [p.id, p]));
}

export function sortStays(stays: Stay[]): Stay[] {
  return [...stays].sort((a, b) => compareDates(a.checkIn, b.checkIn) || compareDates(a.checkOutExclusive, b.checkOutExclusive) || a.id.localeCompare(b.id));
}

export function stayNights(stay: Stay): number {
  return nightsBetween(stay.checkIn, stay.checkOutExclusive);
}

export function totalHotelNights(doc: Pick<TripDocument, 'stays'>): number {
  return doc.stays.reduce((sum, s) => sum + Math.max(0, stayNights(s)), 0);
}

export interface NightBlock {
  stayIds: string[];
  start: string;
  endExclusive: string;
  nights: number;
}

/** Consecutive nights at places carrying `tag`. Adjacent stays join; a gap breaks the run. */
export function qualifyingBlocks(doc: Pick<TripDocument, 'stays' | 'places'>, tag: string): NightBlock[] {
  const places = placeMap(doc);
  const blocks: NightBlock[] = [];
  let current: NightBlock | null = null;
  for (const stay of sortStays(doc.stays)) {
    const qualifies = places.get(stay.placeId)?.tags.includes(tag) ?? false;
    if (!qualifies) {
      current = null;
      continue;
    }
    if (current && current.endExclusive === stay.checkIn) {
      current.stayIds.push(stay.id);
      current.endExclusive = stay.checkOutExclusive;
      current.nights += stayNights(stay);
    } else {
      current = { stayIds: [stay.id], start: stay.checkIn, endExclusive: stay.checkOutExclusive, nights: stayNights(stay) };
      blocks.push(current);
    }
  }
  return blocks;
}

export function longestBlock(blocks: NightBlock[]): NightBlock | null {
  return blocks.reduce<NightBlock | null>((best, b) => (!best || b.nights > best.nights ? b : best), null);
}

/** Dates on which any travel leg departs or arrives, in the local zone of each endpoint. */
export function transferDates(doc: Pick<TripDocument, 'travelLegs'>): Set<string> {
  const out = new Set<string>();
  for (const leg of doc.travelLegs) {
    if (leg.departure) out.add(localDateOf(leg.departure));
    if (leg.arrival) out.add(localDateOf(leg.arrival));
  }
  return out;
}

/**
 * Complete local calendar days at a qualifying base: strictly between check-in
 * and check-out, with no travel that day. Five such dates are not
 * necessarily five consecutive dates.
 */
export function fullDaysAtTag(doc: Pick<TripDocument, 'stays' | 'places' | 'travelLegs'>, tag: string): string[] {
  const places = placeMap(doc);
  const transfers = transferDates(doc);
  const days: string[] = [];
  for (const stay of sortStays(doc.stays)) {
    if (!places.get(stay.placeId)?.tags.includes(tag)) continue;
    for (const date of datesInRange(addDays(stay.checkIn, 1), stay.checkOutExclusive)) {
      if (!transfers.has(date)) days.push(date);
    }
  }
  return days.sort(compareDates);
}

/** Full days inside one block of consecutive qualifying nights (the "main beach block"). */
export function fullDaysInBlock(doc: Pick<TripDocument, 'stays' | 'places' | 'travelLegs'>, block: NightBlock): string[] {
  const ids = new Set(block.stayIds);
  const transfers = transferDates(doc);
  return sortStays(doc.stays)
    .filter((s) => ids.has(s.id))
    .flatMap((s) => datesInRange(addDays(s.checkIn, 1), s.checkOutExclusive))
    .filter((d) => !transfers.has(d))
    .sort(compareDates);
}

export interface StayGap {
  start: string;
  endExclusive: string;
  nights: number;
  afterStayId: string | null;
  beforeStayId: string | null;
}

export function stayGaps(doc: Pick<TripDocument, 'stays' | 'window'>): StayGap[] {
  const stays = sortStays(doc.stays);
  const gaps: StayGap[] = [];
  if (doc.window && stays.length) {
    const first = stays[0]!;
    if (compareDates(doc.window.firstNight, first.checkIn) < 0) {
      gaps.push({ start: doc.window.firstNight, endExclusive: first.checkIn, nights: nightsBetween(doc.window.firstNight, first.checkIn), afterStayId: null, beforeStayId: first.id });
    }
  }
  for (let i = 1; i < stays.length; i++) {
    const prev = stays[i - 1]!;
    const next = stays[i]!;
    if (compareDates(prev.checkOutExclusive, next.checkIn) < 0) {
      gaps.push({ start: prev.checkOutExclusive, endExclusive: next.checkIn, nights: nightsBetween(prev.checkOutExclusive, next.checkIn), afterStayId: prev.id, beforeStayId: next.id });
    }
  }
  if (doc.window && stays.length) {
    const last = stays[stays.length - 1]!;
    if (compareDates(last.checkOutExclusive, doc.window.leaveDate) < 0) {
      gaps.push({ start: last.checkOutExclusive, endExclusive: doc.window.leaveDate, nights: nightsBetween(last.checkOutExclusive, doc.window.leaveDate), afterStayId: last.id, beforeStayId: null });
    }
  }
  return gaps;
}

export function stayOverlaps(doc: Pick<TripDocument, 'stays'>): Array<[Stay, Stay]> {
  const stays = sortStays(doc.stays);
  const out: Array<[Stay, Stay]> = [];
  for (let i = 0; i < stays.length; i++) {
    for (let j = i + 1; j < stays.length; j++) {
      const a = stays[i]!;
      const b = stays[j]!;
      if (compareDates(b.checkIn, a.checkOutExclusive) < 0) out.push([a, b]);
    }
  }
  return out;
}

/** Place sequence home → stays → home, collapsing repeats. */
export function placeSequence(doc: Pick<TripDocument, 'stays' | 'homePlaceId'>): string[] {
  const seq = [doc.homePlaceId];
  for (const stay of sortStays(doc.stays)) {
    if (seq[seq.length - 1] !== stay.placeId) seq.push(stay.placeId);
  }
  if (doc.stays.length && seq[seq.length - 1] !== doc.homePlaceId) seq.push(doc.homePlaceId);
  return seq;
}

export function legInterval(leg: TravelLeg): { start: Temporal.Instant; end: Temporal.Instant } | null {
  const dep = instantOf(leg.departure);
  const arr = instantOf(leg.arrival);
  if (!dep || !arr) return null;
  return { start: dep.subtract({ minutes: leg.preDepartureBufferMinutes }), end: arr.add({ minutes: leg.postArrivalBufferMinutes }) };
}

export function legElapsedMinutes(leg: TravelLeg): number | null {
  const dep = instantOf(leg.departure);
  const arr = instantOf(leg.arrival);
  if (!dep || !arr) return null;
  return Math.round(dep.until(arr, { largestUnit: 'minutes' }).total({ unit: 'minutes' }));
}

export interface DayCard {
  date: string;
  placeIds: string[];
  stayId: string | null;
  isTransferDay: boolean;
  isFullDay: boolean;
  legs: TravelLeg[];
  activities: Activity[];
  freeParts: string[];
}

export function activityDate(activity: Activity): string | null {
  if (activity.start) return localDateOf(activity.start);
  return activity.date ?? null;
}

const PARTS = ['morning', 'afternoon', 'evening'] as const;

/** Local-date cards from the departure date to the day after the last night. */
export function dayCards(doc: TripDocument): DayCard[] {
  const stays = sortStays(doc.stays);
  if (!stays.length) return [];
  const start = compareDates(doc.departureDate, stays[0]!.checkIn) < 0 ? doc.departureDate : stays[0]!.checkIn;
  const lastOut = stays[stays.length - 1]!.checkOutExclusive;
  const returnLegs = doc.travelLegs.filter((l) => l.arrival && l.toPlaceId === doc.homePlaceId).map((l) => localDateOf(l.arrival!));
  const end = [lastOut, ...returnLegs].sort(compareDates).pop()!;
  const transfers = transferDates(doc);
  return datesInRange(start, addDays(end, 1)).map((date) => {
    const nightStay = stays.find((s) => compareDates(s.checkIn, date) <= 0 && compareDates(date, s.checkOutExclusive) < 0) ?? null;
    const morningStay = stays.find((s) => compareDates(s.checkIn, date) < 0 && compareDates(date, s.checkOutExclusive) <= 0) ?? null;
    const placeIds = [...new Set([morningStay?.placeId, nightStay?.placeId].filter((p): p is string => Boolean(p)))];
    const legs = doc.travelLegs.filter((l) => (l.departure && localDateOf(l.departure) === date) || (l.arrival && localDateOf(l.arrival) === date));
    const activities = doc.activities.filter((a) => activityDate(a) === date);
    const isTransferDay = transfers.has(date) || (morningStay?.placeId !== nightStay?.placeId);
    const isFullDay = Boolean(nightStay && morningStay && nightStay.id === morningStay.id && !isTransferDay);
    const used = new Set(activities.map((a) => a.partOfDay ?? partOfDayFromStart(a)).filter(Boolean));
    const freeParts = isFullDay ? PARTS.filter((p) => !used.has(p)) : [];
    return { date, placeIds, stayId: nightStay?.id ?? null, isTransferDay, isFullDay, legs, activities, freeParts };
  });
}

function partOfDayFromStart(activity: Activity): string | null {
  if (!activity.start) return null;
  const hour = Number(activity.start.localDateTime.slice(11, 13));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
