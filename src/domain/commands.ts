import { z } from 'zod';
import { addDays, compareDates, localDateOf, nightsBetween } from './dates';
import { placeSequence, sortStays } from './derive';
import {
  activity as activitySchema,
  anchor as anchorSchema,
  bookingMark as bookingMarkSchema,
  budgetItem as budgetItemSchema,
  budgetSettings,
  claim as claimSchema,
  place as placeSchema,
  plainDate,
  planWindow,
  profile as profileSchema,
  stay as staySchema,
  travelLeg as travelLegSchema,
  zonedTime,
  type Activity,
  type EvidenceStatus,
  type Place,
  type Stay,
  type TravelLeg,
  type TripDocument,
} from './schema';

/**
 * Every edit, from a form, a suggestion, the planner or a future AI model,
 * is one of these typed commands. Nothing else can change a trip.
 */
const id = z.string().min(1).max(120);

export const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ChangeStayDates'), stayId: id, checkIn: plainDate.optional(), checkOutExclusive: plainDate.optional(), shiftFollowing: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('ResizeStay'), stayId: id, nights: z.number().int().min(1).max(365), shiftFollowing: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('AddStay'), stay: staySchema, place: placeSchema.optional(), shiftFollowing: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('RemoveStay'), stayId: id, closeGap: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('MoveStay'), stayId: id, direction: z.enum(['earlier', 'later']) }).strict(),
  z.object({ type: z.literal('ReplaceStop'), stayId: id, place: placeSchema }).strict(),
  z.object({ type: z.literal('UpdateStay'), stayId: id, patch: staySchema.pick({ accommodation: true, purposeTags: true }).partial().strict() }).strict(),
  z.object({ type: z.literal('AddPlace'), place: placeSchema }).strict(),
  z.object({ type: z.literal('AddActivity'), activity: activitySchema }).strict(),
  z
    .object({
      type: z.literal('UpdateActivity'),
      activityId: id,
      patch: activitySchema.pick({ title: true, date: true, partOfDay: true, start: true, end: true, note: true, durationMinutes: true }).partial(),
    })
    .strict(),
  z.object({ type: z.literal('RemoveActivity'), activityId: id }).strict(),
  z.object({ type: z.literal('AddTravelLeg'), leg: travelLegSchema }).strict(),
  z
    .object({
      type: z.literal('UpdateTravelLeg'),
      legId: id,
      patch: z
        .object({
          mode: z.string().min(1).max(200),
          departure: zonedTime.nullable(),
          arrival: zonedTime.nullable(),
          durationRangeMinutes: travelLegSchema.shape.durationRangeMinutes,
          preDepartureBufferMinutes: z.number().int().min(0).max(1440),
          postArrivalBufferMinutes: z.number().int().min(0).max(1440),
          identifiers: travelLegSchema.shape.identifiers,
          note: z.string().max(5000).nullable(),
        })
        .partial()
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('RemoveTravelLeg'), legId: id }).strict(),
  z.object({ type: z.literal('SetPreferences'), patch: profileSchema.partial() }).strict(),
  z
    .object({
      type: z.literal('SetTripDetails'),
      title: z.string().min(1).max(200).optional(),
      departureDate: plainDate.optional(),
      travellers: z.object({ count: z.number().int().min(1).max(50), rooms: z.number().int().min(1).max(50) }).optional(),
      budget: budgetSettings.omit({ fx: true }).partial().optional(),
      window: planWindow.nullable().optional(),
    })
    .strict(),
  z.object({ type: z.literal('SetFx'), fx: budgetSettings.shape.fx }).strict(),
  z.object({ type: z.literal('AddAnchor'), anchor: anchorSchema, activity: activitySchema.optional(), place: placeSchema.optional() }).strict(),
  z.object({ type: z.literal('RemoveAnchor'), anchorId: id }).strict(),
  z.object({ type: z.literal('LockField'), subjectId: id, field: z.string().min(1).max(40) }).strict(),
  z.object({ type: z.literal('UnlockField'), subjectId: id, field: z.string().min(1).max(40) }).strict(),
  z.object({ type: z.literal('AddBudgetItem'), item: budgetItemSchema }).strict(),
  z.object({ type: z.literal('UpdateBudgetItem'), itemId: id, patch: budgetItemSchema.omit({ id: true }).partial() }).strict(),
  z.object({ type: z.literal('RemoveBudgetItem'), itemId: id }).strict(),
  z.object({ type: z.literal('AddClaim'), claim: claimSchema }).strict(),
  z.object({ type: z.literal('RecordBooking'), mark: bookingMarkSchema }).strict(),
  z.object({ type: z.literal('RemoveBookingMark'), markId: id }).strict(),
  z
    .object({
      type: z.literal('SetItinerary'),
      places: z.array(placeSchema).max(300),
      stays: z.array(staySchema).max(200),
      travelLegs: z.array(travelLegSchema).max(300),
      activities: z.array(activitySchema).max(1000),
      claims: z.array(claimSchema).max(2000),
      catalogue: z.object({ packId: id, version: z.string().max(200) }).nullable(),
      planExplanation: z.object({ summary: z.string().max(5000), reasons: z.array(z.string().max(5000)).max(100), unresolved: z.array(z.string().max(5000)).max(100) }).nullable(),
    })
    .strict(),
  z.object({ type: z.literal('SetPrivateNote'), note: z.object({ id, subjectId: id.nullable(), text: z.string().max(5000) }) }).strict(),
  z.object({ type: z.literal('RemovePrivateNote'), noteId: id }).strict(),
  z.object({ type: z.literal('SetTravellerDetails'), names: z.array(z.string().max(200)).max(50), contacts: z.array(z.string().max(200)).max(50) }).strict(),
]);

export type Command = z.infer<typeof command>;
export type Actor = 'user' | 'planner' | 'untrusted_proposal';

export class CommandError extends Error {
  constructor(
    public code: 'locked' | 'not_found' | 'privileged' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

const PLANNER_EVIDENCE: EvidenceStatus[] = ['planning_assumption', 'source_documented', 'synthetic'];
const UNTRUSTED_EVIDENCE: EvidenceStatus[] = ['planning_assumption'];

/**
 * Who may do what. Only the person using the app can record a booking, a
 * quote or a checked timetable, unlock a field or drop a hard commitment.
 * The deterministic planner may cite curated sources; an untrusted
 * proposal (for example from a future language model) may only suggest.
 */
export function authorize(commands: Command[], actor: Actor, doc: TripDocument): string[] {
  if (actor === 'user') return [];
  const problems: string[] = [];
  const allowedEvidence = actor === 'planner' ? PLANNER_EVIDENCE : UNTRUSTED_EVIDENCE;
  const checkEvidence = (status: EvidenceStatus, where: string) => {
    if (!allowedEvidence.includes(status)) problems.push(`${where}: only you can mark evidence as "${status.replaceAll('_', ' ')}".`);
  };
  for (const c of commands) {
    switch (c.type) {
      case 'RecordBooking':
      case 'RemoveBookingMark':
        problems.push('Only you can record or remove a booking.');
        break;
      case 'UnlockField':
        problems.push('Only you can unlock a field.');
        break;
      case 'SetTravellerDetails':
        problems.push('Only you can edit traveller details.');
        break;
      case 'RemoveAnchor': {
        const a = doc.anchors.find((x) => x.id === c.anchorId);
        if (a?.strength === 'hard') problems.push('Only you can remove a hard commitment.');
        break;
      }
      case 'AddClaim':
        checkEvidence(c.claim.evidenceStatus, 'Evidence');
        break;
      case 'SetItinerary':
        for (const cl of c.claims) checkEvidence(cl.evidenceStatus, `Evidence ${cl.id}`);
        break;
      case 'AddBudgetItem':
        if (c.item.status === 'dated_quote' || c.item.status === 'booked_cost') problems.push('Only you can record a quoted or booked price.');
        break;
      case 'UpdateBudgetItem':
        if (c.patch.status === 'dated_quote' || c.patch.status === 'booked_cost') problems.push('Only you can record a quoted or booked price.');
        break;
      default:
        break;
    }
  }
  if (actor === 'untrusted_proposal') {
    for (const c of commands) if (c.type === 'SetPrivateNote' || c.type === 'RemovePrivateNote') problems.push('Suggestions cannot edit private notes.');
  }
  return [...new Set(problems)];
}

function requireStay(doc: TripDocument, stayId: string): Stay {
  const stay = doc.stays.find((s) => s.id === stayId);
  if (!stay) throw new CommandError('not_found', `Stay "${stayId}" not found.`);
  return stay;
}

function nameOf(doc: TripDocument, placeId: string): string {
  return doc.places.find((p) => p.id === placeId)?.name ?? placeId;
}

function shiftDateTime(local: string, days: number): string {
  return `${addDays(local.slice(0, 10), days)}${local.slice(10)}`;
}

function shiftLeg(leg: TravelLeg, days: number): void {
  if (days === 0 || (!leg.departure && !leg.arrival)) return;
  if (leg.lockedFields?.length) throw new CommandError('locked', `The ${leg.lockedFields.join(' and ')} of a travel leg is locked.`);
  if (leg.departure) leg.departure = { ...leg.departure, localDateTime: shiftDateTime(leg.departure.localDateTime, days), offset: null };
  if (leg.arrival) leg.arrival = { ...leg.arrival, localDateTime: shiftDateTime(leg.arrival.localDateTime, days), offset: null };
  if (leg.timingStatus === 'user_entered') leg.timingStatus = 'planning_assumption';
  leg.note = `Moved ${days > 0 ? 'later' : 'earlier'} by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} with its stay. Check the timetable for the new date.`;
}

function inboundLegs(doc: TripDocument, stay: Stay): TravelLeg[] {
  return doc.travelLegs.filter((l) => l.toPlaceId === stay.placeId && l.arrival && [stay.checkIn, addDays(stay.checkIn, -1)].includes(localDateOf(l.arrival)));
}

function outboundLegs(doc: TripDocument, stay: Stay): TravelLeg[] {
  return doc.travelLegs.filter((l) => l.fromPlaceId === stay.placeId && l.departure && localDateOf(l.departure) === stay.checkOutExclusive);
}

function activitiesWithin(doc: TripDocument, stay: Stay): Activity[] {
  return doc.activities.filter((a) => {
    if (a.placeId !== stay.placeId) return false;
    const date = a.start ? localDateOf(a.start) : a.date;
    if (!date) return false;
    return compareDates(stay.checkIn, date) <= 0 && compareDates(date, stay.checkOutExclusive) <= 0;
  });
}

function shiftActivity(a: Activity, days: number): void {
  if (days === 0) return;
  if (a.lockedFields.some((f) => f === 'start' || f === 'end' || f === 'date')) {
    throw new CommandError('locked', `${a.title} is locked to its date and time. Unlock it first if it can really move.`);
  }
  if (a.start) a.start = { ...a.start, localDateTime: shiftDateTime(a.start.localDateTime, days), offset: null };
  if (a.end) a.end = { ...a.end, localDateTime: shiftDateTime(a.end.localDateTime, days), offset: null };
  if (a.date) a.date = addDays(a.date, days);
}

/** Moves whole stays with their activities and travel, each item once. */
function shiftStays(doc: TripDocument, stays: Stay[], days: number, legsAlreadyShifted: Set<string>): void {
  if (days === 0) return;
  const acts = new Set<Activity>();
  for (const s of stays) {
    if (s.lockedFields.includes('checkIn') || s.lockedFields.includes('checkOutExclusive')) {
      throw new CommandError('locked', `${nameOf(doc, s.placeId)} has locked dates. Unlock them first.`);
    }
    for (const a of activitiesWithin(doc, s)) acts.add(a);
    for (const l of [...inboundLegs(doc, s), ...outboundLegs(doc, s)]) {
      if (legsAlreadyShifted.has(l.id)) continue;
      legsAlreadyShifted.add(l.id);
      shiftLeg(l, days);
    }
  }
  for (const a of acts) shiftActivity(a, days);
  for (const s of stays) {
    s.checkIn = addDays(s.checkIn, days);
    s.checkOutExclusive = addDays(s.checkOutExclusive, days);
  }
}

function newLegId(doc: TripDocument, from: string, to: string): string {
  let n = 1;
  while (doc.travelLegs.some((l) => l.id === `leg_${from}_${to}_${n}`)) n++;
  return `leg_${from}_${to}_${n}`;
}

/**
 * After a stop is added, removed, moved or replaced, make sure each pair of
 * consecutive places has exactly one journey. A journey whose route changed
 * keeps its id and evidence links (now inapplicable) but loses its times.
 */
export function reconcileLegs(doc: TripDocument, affected: Set<string>): void {
  const seq = placeSequence(doc);
  const desired: Array<[string, string]> = [];
  for (let i = 1; i < seq.length; i++) desired.push([seq[i - 1]!, seq[i]!]);
  const used = new Set<string>();
  const assigned: Array<TravelLeg | null> = desired.map(([a, b]) => {
    const leg = doc.travelLegs.find((l) => !used.has(l.id) && l.fromPlaceId === a && l.toPlaceId === b);
    if (leg) used.add(leg.id);
    return leg ?? null;
  });
  desired.forEach(([a, b], i) => {
    if (assigned[i]) return;
    const leg = doc.travelLegs.find(
      (l) => !used.has(l.id) && (affected.has(l.fromPlaceId) || affected.has(l.toPlaceId)) && (l.fromPlaceId === a || l.toPlaceId === b),
    );
    if (!leg) return;
    if (leg.lockedFields?.length) throw new CommandError('locked', `The journey ${nameOf(doc, leg.fromPlaceId)} → ${nameOf(doc, leg.toPlaceId)} is locked.`);
    used.add(leg.id);
    const was = `${nameOf(doc, leg.fromPlaceId)} → ${nameOf(doc, leg.toPlaceId)}`;
    leg.fromPlaceId = a;
    leg.toPlaceId = b;
    leg.departure = null;
    leg.arrival = null;
    leg.durationRangeMinutes = null;
    leg.timingStatus = 'unknown';
    leg.mode = 'to be decided';
    leg.identifiers = null;
    leg.note = `Was ${was}. Times and evidence no longer apply because the route changed.`;
    assigned[i] = leg;
  });
  desired.forEach(([a, b], i) => {
    if (assigned[i]) return;
    const leg: TravelLeg = {
      id: newLegId(doc, a, b),
      fromPlaceId: a,
      toPlaceId: b,
      mode: 'to be decided',
      departure: null,
      arrival: null,
      durationRangeMinutes: null,
      preDepartureBufferMinutes: 60,
      postArrivalBufferMinutes: 30,
      timingStatus: 'unknown',
      identifiers: null,
      evidenceIds: [],
      lockedFields: [],
      note: null,
    };
    doc.travelLegs.push(leg);
    used.add(leg.id);
    assigned[i] = leg;
  });
  const keep: TravelLeg[] = [];
  for (const leg of doc.travelLegs) {
    if (used.has(leg.id)) continue;
    const touchesAffected = affected.has(leg.fromPlaceId) || affected.has(leg.toPlaceId);
    if (!touchesAffected) {
      keep.push(leg);
      continue;
    }
    if (leg.lockedFields?.length) throw new CommandError('locked', `The journey ${nameOf(doc, leg.fromPlaceId)} → ${nameOf(doc, leg.toPlaceId)} is locked.`);
  }
  const order = new Map(assigned.map((l, i) => [l!.id, i]));
  doc.travelLegs = [...assigned.filter((l): l is TravelLeg => Boolean(l)), ...keep].sort((x, y) => (order.get(x.id) ?? 1e9) - (order.get(y.id) ?? 1e9));
}

function ensurePlace(doc: TripDocument, place: Place | undefined): void {
  if (!place) return;
  const existing = doc.places.find((p) => p.id === place.id);
  if (!existing) doc.places.push(place);
}

function removeUnlockedActivities(doc: TripDocument, stay: Stay, why: string): void {
  const inside = activitiesWithin(doc, stay);
  for (const a of inside) {
    const anchored = doc.anchors.some((an) => an.kind === 'fixed_event' && an.activityId === a.id);
    if (a.lockedFields.length || anchored) throw new CommandError('locked', `${a.title} is a locked commitment at ${nameOf(doc, stay.placeId)}. ${why}`);
  }
  const ids = new Set(inside.map((a) => a.id));
  doc.activities = doc.activities.filter((a) => !ids.has(a.id));
}

const STAY_LOCK_FIELDS = ['placeId', 'checkIn', 'checkOutExclusive'] as const;
const ACTIVITY_LOCK_FIELDS = ['placeId', 'start', 'end', 'date'] as const;
const LEG_LOCK_FIELDS = ['departure', 'arrival'] as const;

function setLock(doc: TripDocument, subjectId: string, field: string, locked: boolean): void {
  const toggle = <T extends string>(list: T[], f: T) => (locked ? [...new Set([...list, f])] : list.filter((x) => x !== f));
  const stay = doc.stays.find((s) => s.id === subjectId);
  if (stay) {
    const fields = field === 'dates' ? (['checkIn', 'checkOutExclusive'] as const) : [field];
    for (const f of fields) {
      if (!(STAY_LOCK_FIELDS as readonly string[]).includes(f)) throw new CommandError('invalid', `Stays cannot lock "${f}".`);
      stay.lockedFields = toggle(stay.lockedFields, f as (typeof STAY_LOCK_FIELDS)[number]);
    }
    return;
  }
  const act = doc.activities.find((a) => a.id === subjectId);
  if (act) {
    const fields = field === 'time' ? (['start', 'end', 'date'] as const) : [field];
    for (const f of fields) {
      if (!(ACTIVITY_LOCK_FIELDS as readonly string[]).includes(f)) throw new CommandError('invalid', `Activities cannot lock "${f}".`);
      act.lockedFields = toggle(act.lockedFields, f as (typeof ACTIVITY_LOCK_FIELDS)[number]);
    }
    return;
  }
  const leg = doc.travelLegs.find((l) => l.id === subjectId);
  if (leg) {
    const fields = field === 'times' ? (['departure', 'arrival'] as const) : [field];
    for (const f of fields) {
      if (!(LEG_LOCK_FIELDS as readonly string[]).includes(f)) throw new CommandError('invalid', `Journeys cannot lock "${f}".`);
      leg.lockedFields = toggle(leg.lockedFields ?? [], f as (typeof LEG_LOCK_FIELDS)[number]);
    }
    return;
  }
  throw new CommandError('not_found', `Nothing with id "${subjectId}" can be locked.`);
}

function assertLocksPreserved(before: TripDocument, after: Pick<TripDocument, 'stays' | 'activities' | 'travelLegs'>): void {
  for (const l of before.travelLegs) {
    if (!l.lockedFields?.length) continue;
    const n = after.travelLegs.find((x) => x.id === l.id);
    if (!n) throw new CommandError('locked', `The journey ${nameOf(before, l.fromPlaceId)} → ${nameOf(before, l.toPlaceId)} is locked and cannot be dropped by a new plan.`);
    for (const f of l.lockedFields) if (JSON.stringify(n[f]) !== JSON.stringify(l[f])) throw new CommandError('locked', `A locked journey time would change.`);
  }
  for (const s of before.stays) {
    if (!s.lockedFields.length) continue;
    const n = after.stays.find((x) => x.id === s.id);
    if (!n) throw new CommandError('locked', `${nameOf(before, s.placeId)} has locked fields and cannot be removed by a new plan.`);
    for (const f of s.lockedFields) if (n[f] !== s[f]) throw new CommandError('locked', `${nameOf(before, s.placeId)}: the locked ${f} would change.`);
  }
  for (const a of before.activities) {
    if (!a.lockedFields.length) continue;
    const n = after.activities.find((x) => x.id === a.id);
    if (!n) throw new CommandError('locked', `${a.title} is locked and cannot be dropped by a new plan.`);
    for (const f of a.lockedFields) {
      if (JSON.stringify(n[f] ?? null) !== JSON.stringify(a[f] ?? null)) throw new CommandError('locked', `${a.title}: the locked ${f} would change.`);
    }
  }
}

/** Applies one command to a draft document in place. Throws CommandError. */
export function applyCommand(doc: TripDocument, c: Command, actor: Actor): void {
  switch (c.type) {
    case 'ResizeStay': {
      const stay = requireStay(doc, c.stayId);
      applyCommand(doc, { type: 'ChangeStayDates', stayId: c.stayId, checkOutExclusive: addDays(stay.checkIn, c.nights), shiftFollowing: c.shiftFollowing }, actor);
      return;
    }
    case 'ChangeStayDates': {
      const stay = requireStay(doc, c.stayId);
      const newIn = c.checkIn ?? stay.checkIn;
      const newOut = c.checkOutExclusive ?? stay.checkOutExclusive;
      if (newIn !== stay.checkIn && stay.lockedFields.includes('checkIn')) throw new CommandError('locked', `${nameOf(doc, stay.placeId)} check-in is locked.`);
      if (newOut !== stay.checkOutExclusive && stay.lockedFields.includes('checkOutExclusive')) throw new CommandError('locked', `${nameOf(doc, stay.placeId)} check-out is locked.`);
      if (compareDates(newIn, newOut) >= 0) throw new CommandError('invalid', 'Check-out must be after check-in.');
      const deltaIn = nightsBetween(stay.checkIn, newIn);
      const deltaOut = nightsBetween(stay.checkOutExclusive, newOut);
      const shifted = new Set<string>();
      const following = c.shiftFollowing ? sortStays(doc.stays).filter((s) => s.id !== stay.id && compareDates(s.checkIn, stay.checkOutExclusive) >= 0) : [];
      for (const l of inboundLegs(doc, stay)) {
        shifted.add(l.id);
        shiftLeg(l, deltaIn);
      }
      for (const l of outboundLegs(doc, stay)) {
        shifted.add(l.id);
        shiftLeg(l, deltaOut);
      }
      if (following.length) {
        shiftStays(doc, following, deltaOut, shifted);
        const last = following[following.length - 1]!;
        for (const l of doc.travelLegs.filter((x) => x.toPlaceId === doc.homePlaceId && x.fromPlaceId === last.placeId)) {
          if (!shifted.has(l.id)) {
            shifted.add(l.id);
            shiftLeg(l, deltaOut);
          }
        }
        if (doc.window) doc.window = { ...doc.window, leaveDate: addDays(doc.window.leaveDate, deltaOut) };
      }
      stay.checkIn = newIn;
      stay.checkOutExclusive = newOut;
      return;
    }
    case 'AddStay': {
      ensurePlace(doc, c.place);
      if (!doc.places.some((p) => p.id === c.stay.placeId)) throw new CommandError('not_found', `Place "${c.stay.placeId}" is not in this trip.`);
      if (doc.stays.some((s) => s.id === c.stay.id)) throw new CommandError('invalid', `Stay id "${c.stay.id}" already exists.`);
      if (c.shiftFollowing) {
        const nights = nightsBetween(c.stay.checkIn, c.stay.checkOutExclusive);
        const following = sortStays(doc.stays).filter((s) => compareDates(s.checkIn, c.stay.checkIn) >= 0);
        const shifted = new Set<string>();
        for (const l of doc.travelLegs.filter((x) => x.toPlaceId === doc.homePlaceId)) {
          shifted.add(l.id);
          shiftLeg(l, nights);
        }
        shiftStays(doc, following, nights, shifted);
        if (doc.window) doc.window = { ...doc.window, leaveDate: addDays(doc.window.leaveDate, nights) };
      }
      doc.stays.push({ ...c.stay });
      const ordered = sortStays(doc.stays);
      const at = ordered.findIndex((s) => s.id === c.stay.id);
      const affected = new Set([c.stay.placeId, ordered[at - 1]?.placeId ?? doc.homePlaceId, ordered[at + 1]?.placeId ?? doc.homePlaceId]);
      affected.delete(doc.homePlaceId);
      affected.add(c.stay.placeId);
      reconcileLegs(doc, affected);
      return;
    }
    case 'RemoveStay': {
      const stay = requireStay(doc, c.stayId);
      if (stay.lockedFields.length) throw new CommandError('locked', `${nameOf(doc, stay.placeId)} has locked fields. Unlock them before removing it.`);
      removeUnlockedActivities(doc, stay, 'Remove or unlock the commitment first.');
      const nights = nightsBetween(stay.checkIn, stay.checkOutExclusive);
      doc.stays = doc.stays.filter((s) => s.id !== stay.id);
      if (c.closeGap) {
        const following = sortStays(doc.stays).filter((s) => compareDates(s.checkIn, stay.checkIn) >= 0);
        const shifted = new Set<string>();
        shiftStays(doc, following, -nights, shifted);
        if (doc.window) doc.window = { ...doc.window, leaveDate: addDays(doc.window.leaveDate, -nights) };
      }
      reconcileLegs(doc, new Set([stay.placeId]));
      return;
    }
    case 'MoveStay': {
      const sorted = sortStays(doc.stays);
      const i = sorted.findIndex((s) => s.id === c.stayId);
      if (i < 0) throw new CommandError('not_found', `Stay "${c.stayId}" not found.`);
      const j = c.direction === 'earlier' ? i - 1 : i + 1;
      if (j < 0 || j >= sorted.length) throw new CommandError('invalid', 'Nothing to swap with.');
      const [first, second] = i < j ? [sorted[i]!, sorted[j]!] : [sorted[j]!, sorted[i]!];
      for (const s of [first, second]) if (s.lockedFields.length) throw new CommandError('locked', `${nameOf(doc, s.placeId)} has locked fields.`);
      const n1 = nightsBetween(first.checkIn, first.checkOutExclusive);
      const n2 = nightsBetween(second.checkIn, second.checkOutExclusive);
      const start = first.checkIn;
      const gap = nightsBetween(first.checkOutExclusive, second.checkIn);
      const firstActs = activitiesWithin(doc, first).filter((a) => !(a.start && localDateOf(a.start) === first.checkOutExclusive) && a.date !== first.checkOutExclusive);
      const secondActs = activitiesWithin(doc, second).filter((a) => !(a.start && localDateOf(a.start) === second.checkOutExclusive) && a.date !== second.checkOutExclusive);
      const secondShift = nightsBetween(second.checkIn, start);
      const firstShift = nightsBetween(first.checkIn, addDays(start, n2 + gap));
      for (const a of firstActs) shiftActivity(a, firstShift);
      for (const a of secondActs) shiftActivity(a, secondShift);
      second.checkIn = start;
      second.checkOutExclusive = addDays(start, n2);
      first.checkIn = addDays(start, n2 + gap);
      first.checkOutExclusive = addDays(first.checkIn, n1);
      reconcileLegs(doc, new Set([first.placeId, second.placeId]));
      return;
    }
    case 'ReplaceStop': {
      const stay = requireStay(doc, c.stayId);
      if (stay.lockedFields.includes('placeId')) throw new CommandError('locked', `${nameOf(doc, stay.placeId)} is locked as a place.`);
      if (c.place.id === stay.placeId) return;
      ensurePlace(doc, c.place);
      const old = stay.placeId;
      removeUnlockedActivities(doc, stay, 'It cannot move to another city.');
      const oldName = nameOf(doc, old);
      stay.placeId = c.place.id;
      stay.purposeTags = c.place.tags.filter((t) => t !== 'home').slice(0, 8);
      stay.accommodation = null;
      stay.reason = `Replaced ${oldName} with ${c.place.name}, keeping the dates.`;
      reconcileLegs(doc, new Set([old, c.place.id]));
      return;
    }
    case 'UpdateStay': {
      const stay = requireStay(doc, c.stayId);
      Object.assign(stay, c.patch);
      return;
    }
    case 'AddPlace':
      if (doc.places.some((p) => p.id === c.place.id)) throw new CommandError('invalid', `Place id "${c.place.id}" already exists.`);
      doc.places.push(c.place);
      return;
    case 'AddActivity':
      if (!doc.places.some((p) => p.id === c.activity.placeId)) throw new CommandError('not_found', 'That place is not in this trip.');
      if (doc.activities.some((a) => a.id === c.activity.id)) throw new CommandError('invalid', `Activity id "${c.activity.id}" already exists.`);
      doc.activities.push({ ...c.activity });
      return;
    case 'UpdateActivity': {
      const a = doc.activities.find((x) => x.id === c.activityId);
      if (!a) throw new CommandError('not_found', 'Activity not found.');
      const touchesTime = 'date' in c.patch || 'start' in c.patch || 'end' in c.patch;
      if (touchesTime && a.lockedFields.some((f) => f !== 'placeId')) throw new CommandError('locked', `${a.title} is locked to its time.`);
      Object.assign(a, c.patch);
      return;
    }
    case 'RemoveActivity': {
      const a = doc.activities.find((x) => x.id === c.activityId);
      if (!a) throw new CommandError('not_found', 'Activity not found.');
      if (a.lockedFields.length || doc.anchors.some((an) => an.kind === 'fixed_event' && an.activityId === a.id)) {
        throw new CommandError('locked', `${a.title} is a locked commitment. Remove the commitment or unlock it first.`);
      }
      doc.activities = doc.activities.filter((x) => x.id !== a.id);
      return;
    }
    case 'AddTravelLeg':
      if (doc.travelLegs.some((l) => l.id === c.leg.id)) throw new CommandError('invalid', `Travel leg id "${c.leg.id}" already exists.`);
      doc.travelLegs.push({ ...c.leg, timingStatus: c.leg.departure || c.leg.arrival ? (actor === 'user' ? 'user_entered' : 'planning_assumption') : c.leg.timingStatus });
      return;
    case 'UpdateTravelLeg': {
      const leg = doc.travelLegs.find((l) => l.id === c.legId);
      if (!leg) throw new CommandError('not_found', 'Travel leg not found.');
      if (('departure' in c.patch && leg.lockedFields?.includes('departure')) || ('arrival' in c.patch && leg.lockedFields?.includes('arrival'))) {
        throw new CommandError('locked', 'That time is locked.');
      }
      Object.assign(leg, c.patch);
      if ('departure' in c.patch || 'arrival' in c.patch) {
        leg.timingStatus = leg.departure || leg.arrival ? (actor === 'user' ? 'user_entered' : 'planning_assumption') : 'unknown';
      }
      return;
    }
    case 'RemoveTravelLeg': {
      const leg = doc.travelLegs.find((l) => l.id === c.legId);
      if (!leg) throw new CommandError('not_found', 'Travel leg not found.');
      if (leg.lockedFields?.length) throw new CommandError('locked', 'That journey is locked.');
      doc.travelLegs = doc.travelLegs.filter((l) => l.id !== c.legId);
      return;
    }
    case 'SetPreferences':
      doc.profile = { ...doc.profile, ...c.patch, weights: { ...doc.profile.weights, ...(c.patch.weights ?? {}) } };
      return;
    case 'SetTripDetails':
      if (c.title !== undefined) doc.title = c.title;
      if (c.departureDate !== undefined) doc.departureDate = c.departureDate;
      if (c.travellers) doc.travellers = c.travellers;
      if (c.budget) doc.budget = { ...doc.budget, ...c.budget };
      if (c.window !== undefined) doc.window = c.window;
      return;
    case 'SetFx':
      doc.budget = { ...doc.budget, fx: c.fx };
      return;
    case 'AddAnchor':
      ensurePlace(doc, c.place);
      if (c.activity) {
        if (doc.activities.some((a) => a.id === c.activity!.id)) throw new CommandError('invalid', 'Activity id already exists.');
        doc.activities.push(c.activity);
      }
      if (doc.anchors.some((a) => a.id === c.anchor.id)) throw new CommandError('invalid', 'Anchor id already exists.');
      doc.anchors.push(c.anchor);
      return;
    case 'RemoveAnchor':
      if (!doc.anchors.some((a) => a.id === c.anchorId)) throw new CommandError('not_found', 'Commitment not found.');
      doc.anchors = doc.anchors.filter((a) => a.id !== c.anchorId);
      return;
    case 'LockField':
      setLock(doc, c.subjectId, c.field, true);
      return;
    case 'UnlockField':
      setLock(doc, c.subjectId, c.field, false);
      return;
    case 'AddBudgetItem':
      if (doc.budgetItems.some((b) => b.id === c.item.id)) throw new CommandError('invalid', 'Budget item id already exists.');
      doc.budgetItems.push(c.item);
      return;
    case 'UpdateBudgetItem': {
      const item = doc.budgetItems.find((b) => b.id === c.itemId);
      if (!item) throw new CommandError('not_found', 'Budget item not found.');
      Object.assign(item, c.patch);
      return;
    }
    case 'RemoveBudgetItem':
      doc.budgetItems = doc.budgetItems.filter((b) => b.id !== c.itemId);
      return;
    case 'AddClaim':
      if (doc.claims.some((x) => x.id === c.claim.id)) throw new CommandError('invalid', 'Evidence id already exists.');
      doc.claims.push(c.claim);
      return;
    case 'RecordBooking':
      if (doc.bookingMarks.some((b) => b.id === c.mark.id)) throw new CommandError('invalid', 'Booking mark id already exists.');
      doc.bookingMarks.push(c.mark);
      return;
    case 'RemoveBookingMark':
      doc.bookingMarks = doc.bookingMarks.filter((b) => b.id !== c.markId);
      return;
    case 'SetItinerary': {
      assertLocksPreserved(doc, c);
      const keepPlaces = new Map(doc.places.map((p) => [p.id, p]));
      for (const p of c.places) keepPlaces.set(p.id, p);
      doc.places = [...keepPlaces.values()];
      doc.stays = c.stays;
      doc.travelLegs = c.travelLegs;
      doc.activities = c.activities;
      const keptClaims = doc.claims.filter((cl) => cl.evidenceStatus === 'user_recorded' || cl.evidenceStatus === 'live_quote' || cl.evidenceStatus === 'dated_schedule');
      const claimIds = new Set(c.claims.map((x) => x.id));
      doc.claims = [...c.claims, ...keptClaims.filter((k) => !claimIds.has(k.id))];
      doc.catalogue = c.catalogue;
      doc.planExplanation = c.planExplanation;
      return;
    }
    case 'SetPrivateNote': {
      const i = doc.privateNotes.findIndex((n) => n.id === c.note.id);
      if (i >= 0) doc.privateNotes[i] = c.note;
      else doc.privateNotes.push(c.note);
      return;
    }
    case 'RemovePrivateNote':
      doc.privateNotes = doc.privateNotes.filter((n) => n.id !== c.noteId);
      return;
    case 'SetTravellerDetails':
      doc.travellerDetails = { names: c.names, contacts: c.contacts };
      return;
  }
}

/** Commands that change requirements rather than the plan itself. */
export function changesRequirements(c: Command): boolean {
  return c.type === 'AddAnchor' || c.type === 'RemoveAnchor';
}
