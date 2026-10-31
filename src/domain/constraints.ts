import { claimApplicability } from './claims';
import {
  addDays,
  compareDates,
  dateInZone,
  dayOfWeek,
  formatDate,
  formatLocal,
  formatMinutes,
  formatZoned,
  localDateOf,
  resolveZoned,
  toZoned,
  Temporal,
  type ZonedTime,
} from './dates';
import {
  activityDate,
  fullDaysAtTag,
  legInterval,
  longestBlock,
  placeMap,
  placeSequence,
  qualifyingBlocks,
  sortStays,
  stayGaps,
  stayNights,
  stayOverlaps,
} from './derive';
import type { Activity, Anchor, TravelLeg, TripDocument } from './schema';

export type ConstraintStatus = 'satisfied' | 'violated' | 'unresolved';

export interface ConstraintResult {
  id: string;
  anchorId: string | null;
  label: string;
  strength: 'hard' | 'soft' | 'structural';
  status: ConstraintStatus;
  explanation: string;
  subjectIds: string[];
  relaxations: string[];
}

type Instant = Temporal.Instant;

function cmp(a: Instant, b: Instant): number {
  return a.epochMilliseconds - b.epochMilliseconds;
}

function minutesBetween(a: Instant, b: Instant): number {
  return Math.round((b.epochMilliseconds - a.epochMilliseconds) / 60000);
}

function resolveOrExplain(time: ZonedTime, what: string): { instant: Instant } | { problem: string } {
  const r = resolveZoned(time);
  if (r.status === 'ok') return { instant: r.instant };
  return { problem: `${what}: ${r.message}` };
}

export interface FeasibilityResult {
  status: ConstraintStatus;
  claimFeasible: boolean;
  message: string;
}

/** A leg without real times is never "feasible", only estimated. */
export function legFeasibility(leg: TravelLeg): FeasibilityResult {
  if (!leg.departure || !leg.arrival) {
    if (leg.durationRangeMinutes) {
      const { min, max } = leg.durationRangeMinutes;
      return {
        status: 'unresolved',
        claimFeasible: false,
        message: `Estimated ${formatMinutes(min)}–${formatMinutes(max)} of travel. No timetable has been checked.`,
      };
    }
    return { status: 'unresolved', claimFeasible: false, message: 'No departure or arrival time yet.' };
  }
  const dep = resolveOrExplain(leg.departure, 'Departure');
  const arr = resolveOrExplain(leg.arrival, 'Arrival');
  if ('problem' in dep) return { status: 'unresolved', claimFeasible: false, message: dep.problem };
  if ('problem' in arr) return { status: 'unresolved', claimFeasible: false, message: arr.problem };
  if (cmp(arr.instant, dep.instant) <= 0) {
    return { status: 'violated', claimFeasible: false, message: 'Arrival is not after departure once time zones are applied.' };
  }
  const minutes = minutesBetween(dep.instant, arr.instant);
  const assumed = leg.timingStatus !== 'user_entered';
  return {
    status: assumed ? 'unresolved' : 'satisfied',
    claimFeasible: !assumed,
    message: assumed
      ? `${formatMinutes(minutes)} door to door on assumed times (${leg.timingStatus.replaceAll('_', ' ')}).`
      : `${formatMinutes(minutes)} on the times you entered.`,
  };
}

function eventInterval(doc: TripDocument, anchor: Extract<Anchor, { kind: 'fixed_event' }>) {
  const activity = doc.activities.find((a) => a.id === anchor.activityId);
  if (!activity) return { problem: 'The event this anchor refers to is missing.' } as const;
  if (!activity.start || !activity.end) return { problem: `${activity.title} has no start and end time yet.`, activity } as const;
  const s = resolveOrExplain(activity.start, `${activity.title} start`);
  const e = resolveOrExplain(activity.end, `${activity.title} end`);
  if ('problem' in s) return { problem: s.problem, activity } as const;
  if ('problem' in e) return { problem: e.problem, activity } as const;
  const buffer = anchor.arrivalBufferMinutes ?? 0;
  return { activity, start: s.instant.subtract({ minutes: buffer }), end: e.instant, buffer } as const;
}

function describeEvent(activity: Activity, buffer: number): string {
  const range = `${formatLocal(activity.start!.localDateTime)} – ${formatLocal(activity.end!.localDateTime)} (${activity.start!.timeZone})`;
  return buffer ? `${range}, plus ${formatMinutes(buffer)} to arrive beforehand` : range;
}

/**
 * Checks that the traveller is at `placeId` for the whole interval: a stay
 * covers it, nobody is in transit during it, and arrival/departure days have
 * real times that fit. Unknown times give "unresolved", never "satisfied".
 */
function presenceCheck(
  doc: TripDocument,
  placeId: string,
  start: Instant,
  end: Instant,
  what: string,
): { status: ConstraintStatus; explanation: string; subjectIds: string[]; relaxations: string[] } {
  const places = placeMap(doc);
  const place = places.get(placeId);
  if (!place) return { status: 'violated', explanation: `${what}: its place is missing from the trip.`, subjectIds: [], relaxations: [] };
  for (const leg of doc.travelLegs) {
    const interval = legInterval(leg);
    if (!interval) continue;
    if (cmp(interval.start, end) < 0 && cmp(interval.end, start) > 0) {
      const from = places.get(leg.fromPlaceId)?.name ?? leg.fromPlaceId;
      const to = places.get(leg.toPlaceId)?.name ?? leg.toPlaceId;
      return {
        status: 'violated',
        explanation: `${what}. Travel ${from} → ${to} (departs ${formatZoned(leg.departure!)}, with ${formatMinutes(leg.preDepartureBufferMinutes)} to get there) overlaps this interval.`,
        subjectIds: [leg.id],
        relaxations: [
          `Depart ${from} no earlier than ${formatZoned(toZoned(end.add({ minutes: leg.preDepartureBufferMinutes }), leg.departure!.timeZone))}.`,
          'Or unlock the commitment yourself if it can really move.',
        ],
      };
    }
  }
  const startDate = dateInZone(start, place.timeZone);
  const endDate = dateInZone(end, place.timeZone);
  const stay = sortStays(doc.stays).find(
    (s) => s.placeId === placeId && compareDates(s.checkIn, startDate) <= 0 && compareDates(s.checkOutExclusive, endDate) >= 0,
  );
  if (!stay) {
    return {
      status: doc.stays.length ? 'violated' : 'unresolved',
      explanation: `${what}. No stay at ${place.name} covers ${formatDate(startDate)} to ${formatDate(endDate)}.`,
      subjectIds: [],
      relaxations: [`Stay at ${place.name} from ${formatDate(startDate)} until at least ${formatDate(addDays(endDate, compareDates(endDate, startDate) === 0 ? 1 : 0))}.`],
    };
  }
  const unresolved: string[] = [];
  if (stay.checkIn === startDate) {
    const inbound = doc.travelLegs.find((l) => l.toPlaceId === placeId && (!l.arrival || localDateOf(l.arrival) === startDate));
    const arr = inbound?.arrival ? resolveInstant(inbound.arrival) : null;
    if (!inbound || !arr) unresolved.push(`Your arrival time at ${place.name} on ${formatDate(startDate)} is unknown.`);
    else if (cmp(arr.add({ minutes: inbound.postArrivalBufferMinutes }), start) > 0) {
      return {
        status: 'violated',
        explanation: `${what}. You reach ${place.name} at ${formatZoned(inbound.arrival!)} plus ${formatMinutes(inbound.postArrivalBufferMinutes)} transfer, which is too late.`,
        subjectIds: [inbound.id, stay.id],
        relaxations: ['Arrive earlier, or arrive the day before.'],
      };
    }
  }
  if (stay.checkOutExclusive === endDate) {
    const outbound = doc.travelLegs.find((l) => l.fromPlaceId === placeId && (!l.departure || localDateOf(l.departure) === endDate));
    const dep = outbound?.departure ? resolveInstant(outbound.departure) : null;
    if (!outbound || !dep) unresolved.push(`Your departure time from ${place.name} on ${formatDate(endDate)} is unknown.`);
    else if (cmp(dep.subtract({ minutes: outbound.preDepartureBufferMinutes }), end) < 0) {
      return {
        status: 'violated',
        explanation: `${what}. You leave ${place.name} at ${formatZoned(outbound.departure!)}, before it ends.`,
        subjectIds: [outbound.id, stay.id],
        relaxations: ['Leave later, or stay one more night.'],
      };
    }
  }
  if (unresolved.length) return { status: 'unresolved', explanation: `${what}. ${unresolved.join(' ')}`, subjectIds: [stay.id], relaxations: ['Enter the travel times to confirm.'] };
  return { status: 'satisfied', explanation: `${what}. You are at ${place.name} throughout (${stay.checkIn} to ${stay.checkOutExclusive}).`, subjectIds: [stay.id], relaxations: [] };
}

function resolveInstant(time: ZonedTime): Instant | null {
  const r = resolveZoned(time);
  return r.status === 'ok' ? r.instant : null;
}

function evaluateAnchor(doc: TripDocument, anchor: Anchor): ConstraintResult {
  const places = placeMap(doc);
  const base = { id: `anchor:${anchor.id}`, anchorId: anchor.id, strength: anchor.strength } as const;
  const nameOf = (id: string) => places.get(id)?.name ?? id;
  switch (anchor.kind) {
    case 'fixed_event': {
      const ev = eventInterval(doc, anchor);
      const label = anchor.label ?? `Be at ${ev.activity?.title ?? 'the event'}`;
      if ('problem' in ev) return { ...base, label, status: 'unresolved', explanation: ev.problem ?? '', subjectIds: [anchor.activityId], relaxations: [] };
      const r = presenceCheck(doc, ev.activity.placeId, ev.start, ev.end, `${ev.activity.title}: ${describeEvent(ev.activity, ev.buffer)}`);
      return { ...base, label, ...r, subjectIds: [anchor.activityId, ...r.subjectIds] };
    }
    case 'protected_rest': {
      const label = anchor.label ?? `Protected rest at ${nameOf(anchor.placeId)}`;
      const s = resolveOrExplain(anchor.start, 'Rest start');
      const e = resolveOrExplain(anchor.end, 'Rest end');
      if ('problem' in s || 'problem' in e) {
        return { ...base, label, status: 'unresolved', explanation: 'problem' in s ? s.problem : (e as { problem: string }).problem, subjectIds: [], relaxations: [] };
      }
      const what = `Rest ${formatLocal(anchor.start.localDateTime)} – ${formatLocal(anchor.end.localDateTime)} (${anchor.start.timeZone})`;
      for (const a of doc.activities) {
        if (!a.start || !a.end) continue;
        const as = resolveInstant(a.start);
        const ae = resolveInstant(a.end);
        if (as && ae && cmp(as, e.instant) < 0 && cmp(ae, s.instant) > 0) {
          return { ...base, label, status: 'violated', explanation: `${what}. ${a.title} overlaps it.`, subjectIds: [a.id], relaxations: [`Move ${a.title} outside the rest period.`] };
        }
      }
      const r = presenceCheck(doc, anchor.placeId, s.instant, e.instant, what);
      return { ...base, label, ...r };
    }
    case 'arrival_deadline': {
      const label = anchor.label ?? `Home by ${formatZoned(anchor.deadline)}`;
      const deadline = resolveOrExplain(anchor.deadline, 'Deadline');
      if ('problem' in deadline) return { ...base, label, status: 'unresolved', explanation: deadline.problem, subjectIds: [], relaxations: [] };
      // Even without journey times: if the last stay only ends after the deadline has passed, it cannot be met.
      const lastStay = sortStays(doc.stays).filter((st) => st.placeId !== anchor.placeId).pop();
      const lastZone = lastStay ? places.get(lastStay.placeId)?.timeZone : undefined;
      if (lastStay && lastZone) {
        const leavesFrom = Temporal.PlainDate.from(lastStay.checkOutExclusive).toZonedDateTime({ timeZone: lastZone }).toInstant();
        if (cmp(leavesFrom, deadline.instant) > 0) {
          return {
            ...base,
            label,
            status: 'violated',
            explanation: `Your last stay, ${nameOf(lastStay.placeId)}, ends on ${formatDate(lastStay.checkOutExclusive)}, after the deadline of ${formatZoned(anchor.deadline)} has already passed.`,
            subjectIds: [lastStay.id],
            relaxations: [`End ${nameOf(lastStay.placeId)} earlier, or shorten an earlier stay.`, 'Move the deadline, if it is really flexible.'],
          };
        }
      }
      const legs = doc.travelLegs.filter((l) => l.toPlaceId === anchor.placeId);
      if (!legs.length) return { ...base, label, status: 'unresolved', explanation: `No journey to ${nameOf(anchor.placeId)} yet.`, subjectIds: [], relaxations: ['Add your return journey.'] };
      const untimed = legs.filter((l) => !l.arrival || !resolveInstant(l.arrival));
      if (untimed.length) {
        return { ...base, label, status: 'unresolved', explanation: `The arrival time of your journey to ${nameOf(anchor.placeId)} is unknown, so the deadline cannot be checked.`, subjectIds: untimed.map((l) => l.id), relaxations: ['Enter the arrival time and time zone of your return journey.'] };
      }
      const last = legs.map((l) => ({ l, arr: resolveInstant(l.arrival!)! })).sort((a, b) => cmp(b.arr, a.arr))[0]!;
      const buffer = anchor.includePostArrivalBuffer ? last.l.postArrivalBufferMinutes : 0;
      const ready = last.arr.add({ minutes: buffer });
      const readyText = formatZoned(toZoned(ready, anchor.deadline.timeZone));
      const diff = minutesBetween(ready, deadline.instant);
      if (diff >= 0) {
        return { ...base, label, status: 'satisfied', explanation: `Ready at ${readyText}${buffer ? ` after a ${formatMinutes(buffer)} transfer` : ''}, ${formatMinutes(diff)} before the deadline.`, subjectIds: [last.l.id], relaxations: [] };
      }
      return {
        ...base,
        label,
        status: 'violated',
        explanation: `Ready at ${readyText}${buffer ? ` after a ${formatMinutes(buffer)} transfer` : ''}, which is ${formatMinutes(-diff)} after the deadline of ${formatZoned(anchor.deadline)}. What counts is arriving, not leaving.`,
        subjectIds: [last.l.id],
        relaxations: [`Choose a journey arriving at least ${formatMinutes(-diff)} earlier.`, 'Move the deadline, if it is really flexible.'],
      };
    }
    case 'minimum_consecutive_nights': {
      const label = anchor.label ?? `${anchor.minimumNights} consecutive ${anchor.qualifyingTag} nights`;
      const best = longestBlock(qualifyingBlocks(doc, anchor.qualifyingTag));
      if (!doc.stays.length) return { ...base, label, status: 'unresolved', explanation: 'No stays yet.', subjectIds: [], relaxations: [] };
      const nights = best?.nights ?? 0;
      if (nights >= anchor.minimumNights) {
        return { ...base, label, status: 'satisfied', explanation: `${nights} consecutive nights from ${formatDate(best!.start)} to ${formatDate(best!.endExclusive)}.`, subjectIds: best!.stayIds, relaxations: [] };
      }
      const deficit = anchor.minimumNights - nights;
      const lastStay = best ? doc.stays.find((s) => s.id === best.stayIds[best.stayIds.length - 1]) : null;
      return {
        ...base,
        label,
        status: 'violated',
        explanation: best
          ? `The longest run is ${nights} night${nights === 1 ? '' : 's'} (${formatDate(best.start)} to ${formatDate(best.endExclusive)}). You asked for ${anchor.minimumNights}.`
          : `No ${anchor.qualifyingTag} nights in the plan. You asked for ${anchor.minimumNights}.`,
        subjectIds: best?.stayIds ?? [],
        relaxations: [
          lastStay ? `Extend ${nameOf(lastStay.placeId)} by ${deficit} night${deficit === 1 ? '' : 's'}.` : `Add a ${anchor.qualifyingTag} stop of ${anchor.minimumNights} nights.`,
          `Add an adjacent ${anchor.qualifyingTag} stop.`,
          `Lower the minimum to ${nights} (your call).`,
        ],
      };
    }
    case 'minimum_full_days': {
      const label = anchor.label ?? `${anchor.minimumDays} full ${anchor.qualifyingTag} days`;
      const days = fullDaysAtTag(doc, anchor.qualifyingTag);
      if (days.length >= anchor.minimumDays) return { ...base, label, status: 'satisfied', explanation: `${days.length} full days: ${days.map((d) => formatDate(d, { weekday: false })).join(', ')}. Arrival, departure and transfer days are not counted.`, subjectIds: [], relaxations: [] };
      return { ...base, label, status: 'violated', explanation: `Only ${days.length} full day${days.length === 1 ? '' : 's'} with no travel. Arrival, departure and transfer days are not counted.`, subjectIds: [], relaxations: [`Add ${anchor.minimumDays - days.length} more night(s) at a ${anchor.qualifyingTag} base, or reduce moves between bases.`] };
    }
    case 'minimum_nights_at_place': {
      const label = anchor.label ?? `At least ${anchor.minimumNights} nights in ${nameOf(anchor.placeId)}`;
      const nights = doc.stays.filter((s) => s.placeId === anchor.placeId).reduce((n, s) => n + stayNights(s), 0);
      if (nights >= anchor.minimumNights) return { ...base, label, status: 'satisfied', explanation: `${nights} nights planned.`, subjectIds: [], relaxations: [] };
      return { ...base, label, status: doc.stays.length ? 'violated' : 'unresolved', explanation: `${nights} of ${anchor.minimumNights} nights planned.`, subjectIds: [], relaxations: [`Add ${anchor.minimumNights - nights} night(s) in ${nameOf(anchor.placeId)}.`] };
    }
    case 'required_place': {
      const label = anchor.label ?? `Visit ${nameOf(anchor.placeId)}`;
      const ok = doc.stays.some((s) => s.placeId === anchor.placeId);
      return { ...base, label, status: ok ? 'satisfied' : doc.stays.length ? 'violated' : 'unresolved', explanation: ok ? 'Included.' : `${nameOf(anchor.placeId)} is not in the plan.`, subjectIds: [], relaxations: ok ? [] : [`Add a stay in ${nameOf(anchor.placeId)}.`] };
    }
    case 'excluded_place': {
      const label = anchor.label ?? `Avoid ${nameOf(anchor.placeId)}`;
      const hits = doc.stays.filter((s) => s.placeId === anchor.placeId);
      return { ...base, label, status: hits.length ? 'violated' : 'satisfied', explanation: hits.length ? `${nameOf(anchor.placeId)} is in the plan.` : 'Not in the plan.', subjectIds: hits.map((s) => s.id), relaxations: hits.length ? [`Replace ${nameOf(anchor.placeId)}.`] : [] };
    }
  }
}

function structuralChecks(doc: TripDocument): ConstraintResult[] {
  const places = placeMap(doc);
  const nameOf = (id: string) => places.get(id)?.name ?? id;
  const out: ConstraintResult[] = [];
  const s = (id: string, label: string, status: ConstraintStatus, explanation: string, subjectIds: string[] = [], relaxations: string[] = []): ConstraintResult => ({
    id,
    anchorId: null,
    label,
    strength: 'structural',
    status,
    explanation,
    subjectIds,
    relaxations,
  });
  for (const stay of doc.stays) {
    if (compareDates(stay.checkIn, stay.checkOutExclusive) >= 0) {
      out.push(s(`stay-order:${stay.id}`, `${nameOf(stay.placeId)} dates`, 'violated', 'Check-out must be after check-in.', [stay.id]));
    }
  }
  for (const [a, b] of stayOverlaps(doc)) {
    out.push(s(`overlap:${a.id}:${b.id}`, 'Overlapping stays', 'violated', `${nameOf(a.placeId)} (to ${formatDate(a.checkOutExclusive)}) overlaps ${nameOf(b.placeId)} (from ${formatDate(b.checkIn)}).`, [a.id, b.id], ['Shorten one of the stays.']));
  }
  for (const gap of stayGaps(doc)) {
    out.push(s(`gap:${gap.start}`, 'Nights without a stay', 'unresolved', `No accommodation planned for ${gap.nights} night${gap.nights === 1 ? '' : 's'} from ${formatDate(gap.start)}.`, [gap.afterStayId, gap.beforeStayId].filter((x): x is string => Boolean(x)), ['Extend a neighbouring stay or add one.']));
  }
  const seq = placeSequence(doc);
  for (let i = 1; i < seq.length; i++) {
    const from = seq[i - 1]!;
    const to = seq[i]!;
    if (!doc.travelLegs.some((l) => l.fromPlaceId === from && l.toPlaceId === to)) {
      out.push(s(`missing-leg:${from}:${to}`, 'Missing journey', 'unresolved', `No journey from ${nameOf(from)} to ${nameOf(to)} yet.`, [], ['Add a travel leg.']));
    }
  }
  for (const leg of doc.travelLegs) {
    const f = legFeasibility(leg);
    if (f.status !== 'satisfied') {
      out.push(s(`leg:${leg.id}`, `${nameOf(leg.fromPlaceId)} → ${nameOf(leg.toPlaceId)}`, f.status, f.message, [leg.id], f.status === 'violated' ? ['Fix the times or time zones.'] : ['Check a current timetable and enter the times.']));
    }
  }
  for (const a of doc.activities) {
    const date = activityDate(a);
    if (!date) continue;
    const there = doc.stays.some((st) => st.placeId === a.placeId && compareDates(st.checkIn, date) <= 0 && compareDates(date, st.checkOutExclusive) <= 0);
    if (!there && doc.stays.length) {
      out.push(s(`activity-place:${a.id}`, a.title, 'unresolved', `${a.title} is on ${formatDate(date)}, when the plan has you somewhere other than ${nameOf(a.placeId)}.`, [a.id], ['Move the activity or the stay.']));
    }
  }
  const DAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  for (const a of doc.activities) {
    const date = activityDate(a);
    if (!date || !a.daysOfWeek?.length) continue;
    const dow = dayOfWeek(date);
    if (!a.daysOfWeek.includes(dow)) {
      out.push(s(`weekday:${a.id}`, a.title, 'unresolved', `${a.title} usually runs on ${a.daysOfWeek.map((d) => DAY_NAMES[d - 1]).join(' and ')}, but it is now planned for ${formatDate(date)}.`, [a.id], ['Move it to a matching day, or check the current schedule.']));
    }
  }
  for (const mark of doc.bookingMarks) {
    const exists = doc.stays.some((x) => x.id === mark.subjectId) || doc.travelLegs.some((x) => x.id === mark.subjectId) || doc.activities.some((x) => x.id === mark.subjectId);
    if (!exists && mark.status !== 'cancelled') {
      out.push(s(`booking:${mark.id}`, 'Booking no longer matches the plan', 'unresolved', 'You recorded a booking for an item that is no longer in the plan. Editing the plan did not change or cancel the booking itself.', [mark.subjectId], ['Check the booking with the provider.']));
    }
  }
  const stale = doc.claims.filter((c) => !claimApplicability(doc, c).applicable);
  if (stale.length) {
    out.push(s('evidence:inapplicable', 'Evidence to re-check', 'unresolved', `${stale.length} evidence record${stale.length === 1 ? '' : 's'} belonged to an earlier version of the route and no longer apply.`, stale.map((c) => c.subjectId), ['Find new evidence for the changed legs or stays.']));
  }
  return out;
}

function eventPairChecks(doc: TripDocument): ConstraintResult[] {
  const out: ConstraintResult[] = [];
  const events = doc.anchors.filter((a): a is Extract<Anchor, { kind: 'fixed_event' }> => a.kind === 'fixed_event' && a.strength === 'hard');
  const intervals = events.map((a) => ({ anchor: a, iv: eventInterval(doc, a) }));
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const A = intervals[i]!.iv;
      const B = intervals[j]!.iv;
      if ('problem' in A || 'problem' in B) continue;
      if (A.activity.placeId === B.activity.placeId) continue;
      if (cmp(A.start, B.end) < 0 && cmp(B.start, A.end) > 0) {
        out.push({
          id: `event-clash:${intervals[i]!.anchor.id}:${intervals[j]!.anchor.id}`,
          anchorId: intervals[i]!.anchor.id,
          label: 'Two fixed events overlap',
          strength: 'hard',
          status: 'violated',
          explanation: `${A.activity.title} (${describeEvent(A.activity, A.buffer)}) and ${B.activity.title} (${describeEvent(B.activity, B.buffer)}) need you in two places at once. Neither has been unlocked.`,
          subjectIds: [A.activity.id, B.activity.id],
          relaxations: [`Drop or move ${A.activity.title}.`, `Drop or move ${B.activity.title}.`],
        });
      }
    }
  }
  return out;
}

export function evaluateConstraints(doc: TripDocument): ConstraintResult[] {
  return [...doc.anchors.map((a) => evaluateAnchor(doc, a)), ...eventPairChecks(doc), ...structuralChecks(doc)];
}

export function hardViolations(results: ConstraintResult[]): ConstraintResult[] {
  return results.filter((r) => r.status === 'violated' && r.strength !== 'soft');
}
