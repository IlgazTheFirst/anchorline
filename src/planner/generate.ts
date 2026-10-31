import type { CatalogueActivity, CataloguePlace, DestinationPack } from '../catalogue/schema';
import { addDays, compareDates, datesInRange, dayOfWeek, formatDate, formatMinutes, monthOf, nightsBetween } from '../domain/dates';
import { recoveryMornings } from '../domain/derive';
import type { Activity, Claim, Interest, PartOfDay, Place, Stay, TravelLeg } from '../domain/schema';
import { allocateNights, type StopSpec } from './allocate';
import { RouteGraph, type Transfer } from './graph';
import { activityAllowed, activityScore, nightsUtility, PACE, placeValue, varietyBonus, WEIGHTS } from './score';
import type { Alternative, Conflict, Pin, PlanRequest, PlanResult, ScoreBreakdown, StopPlan } from './types';

export const MAX_PLAN_NIGHTS = 90;
const BEAM_WIDTH = 160;
const DP_PER_LEVEL = 48;

interface Node {
  id: string;
  name: string;
  catalogue: CataloguePlace | null;
  custom: Place | null;
  lo: number;
  hi: number;
  ideal: number;
  value: number;
  matched: Interest[];
  seasonNote: string | null;
  tags: string[];
  gateway: 'major' | 'regional' | 'none';
  pins: Pin[];
}

interface Candidate {
  seq: string[];
  partial: number;
}

interface Evaluated {
  seq: string[];
  nights: number[];
  score: ScoreBreakdown;
}

export interface PlanOptions {
  /** Evaluate exactly this place order (used to preview an alternative). */
  sequence?: string[];
}

const graphCache = new WeakMap<DestinationPack, RouteGraph>();
function graphFor(pack: DestinationPack): RouteGraph {
  let g = graphCache.get(pack);
  if (!g) {
    g = new RouteGraph(pack);
    graphCache.set(pack, g);
  }
  return g;
}

const INTEREST_WORDS: Record<Interest, string> = {
  food: 'food',
  nightlife: 'evenings out',
  beach: 'beaches',
  culture: 'culture',
  nature: 'nature',
  adventure: 'a little adventure',
  city: 'city life',
  relax: 'downtime',
};

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function empty(req: PlanRequest, conflicts: Conflict[], outside: string[] = []): PlanResult {
  return {
    status: 'infeasible',
    stops: [],
    places: [],
    stays: [],
    travelLegs: [],
    activities: [],
    claims: [],
    summary: 'No plan could meet every requirement.',
    reasons: [],
    unresolved: [],
    conflicts,
    alternatives: [],
    score: null,
    coverage: { packId: req.pack.packId, packTitle: req.pack.title, version: req.pack.version, outside },
  };
}

/**
 * Deterministic planner. Same request + same pack version → same plan.
 * 1. validate dates and requirements; 2. build candidate stops with night
 * bounds; 3. beam-search place orders over the route graph; 4. allocate
 * nights exactly with a dynamic programme; 5. score, explain, and build an
 * editable itinerary with honest transport assumptions.
 */
export function generatePlan(req: PlanRequest, options: PlanOptions = {}): PlanResult {
  const N = nightsBetween(req.firstNight, req.leaveDate);
  const conflicts = basicConflicts(req, N);
  if (conflicts.length) return empty(req, conflicts);

  const month = monthOf(addDays(req.firstNight, Math.floor(N / 2)));
  const pace = PACE[req.profile.pace];
  const graph = graphFor(req.pack);
  const excluded = new Set(req.excludedPlaceIds);
  const catalogueIds = new Set(req.pack.places.map((p) => p.id));
  const outside = [...new Set([...req.requiredPlaceIds, ...req.pins.map((p) => p.placeId)])].filter((id) => !catalogueIds.has(id) && !req.customPlaces.some((c) => c.id === id));
  if (outside.length) {
    return empty(req, [{ title: 'Places outside the catalogue', explanation: `These places are not in the ${req.pack.title} pack and have no details: ${outside.join(', ')}.`, relaxations: ['Add them as custom places and plan those days by hand.'], constraintIds: [] }], outside);
  }

  const nodes = new Map<string, Node>();
  const consecutiveTags = new Set(req.consecutive.map((c) => c.tag));
  const offset = (date: string) => nightsBetween(req.firstNight, date);
  for (const p of req.pack.places) {
    if (excluded.has(p.id)) continue;
    const pv = placeValue(p, req.profile, month);
    const lo0 = Math.min(p.recommendedNights.max, Math.max(p.recommendedNights.min, pace.minNights));
    let hi = p.recommendedNights.max + pace.extraMax + (p.tags.some((t) => consecutiveTags.has(t)) ? 3 : 0);
    let lo = Math.max(lo0, req.minNights[p.id] ?? 0);
    const pins = req.pins.filter((x) => x.placeId === p.id);
    for (const pin of pins) {
      const len = offset(pin.lastNight) - offset(pin.firstNight) + 1;
      if (pin.exact) {
        lo = len;
        hi = len;
      } else {
        lo = Math.max(lo, len);
        hi = Math.max(hi, len);
      }
    }
    hi = Math.max(hi, lo);
    nodes.set(p.id, { id: p.id, name: p.name, catalogue: p, custom: null, lo, hi, ideal: Math.min(hi, Math.max(lo, p.recommendedNights.ideal)), value: pv.value, matched: pv.matched, seasonNote: pv.seasonNote, tags: p.tags, gateway: p.gateway, pins });
  }
  for (const c of req.customPlaces) {
    const pins = req.pins.filter((x) => x.placeId === c.id);
    if (!pins.length && !req.requiredPlaceIds.includes(c.id)) continue;
    let lo = Math.max(1, req.minNights[c.id] ?? 1);
    let hi = Math.max(lo, N);
    for (const pin of pins) {
      const len = offset(pin.lastNight) - offset(pin.firstNight) + 1;
      if (pin.exact) {
        lo = len;
        hi = len;
      } else lo = Math.max(lo, len);
    }
    nodes.set(c.id, { id: c.id, name: c.name, catalogue: null, custom: c, lo, hi: Math.max(hi, lo), ideal: lo, value: 0.3, matched: [], seasonNote: null, tags: c.tags, gateway: 'none', pins });
  }

  const required = new Set([...req.requiredPlaceIds, ...req.pins.map((p) => p.placeId)]);
  for (const r of required) {
    if (!nodes.has(r)) return empty(req, [{ title: 'A required place is excluded', explanation: `${r} is both required and excluded.`, relaxations: ['Remove one of the two requirements.'], constraintIds: [] }]);
  }
  const pinOrder = [...req.pins].sort((a, b) => compareDates(a.firstNight, b.firstNight) || a.placeId.localeCompare(b.placeId));

  const transferCost = (a: string, b: string): number | null => {
    const na = nodes.get(a)!;
    const nb = nodes.get(b)!;
    if (!na.catalogue || !nb.catalogue) return WEIGHTS.unknownTransfer;
    const t = graph.get(a, b);
    if (!t) return null;
    return (t.typicalMinutes / 60) * WEIGHTS.transferPerHour + (t.hops.length - 1) * WEIGHTS.extraHop;
  };
  const majors = req.pack.places.filter((p) => p.gateway === 'major').map((p) => p.id);
  const gatewayCost = (placeId: string, chosen: string | null): number | null => {
    const n = nodes.get(placeId)!;
    if (!n.catalogue) return WEIGHTS.unknownTransfer;
    if (chosen) {
      if (chosen === placeId) return 0;
      const t = graph.get(chosen, placeId);
      return t ? (t.typicalMinutes / 60) * WEIGHTS.transferPerHour + 0.1 : null;
    }
    if (n.gateway === 'major') return 0;
    const costs = majors.map((m) => graph.get(m, placeId)).filter((t): t is Transfer => Boolean(t)).map((t) => (t.typicalMinutes / 60) * WEIGHTS.transferPerHour + 0.1);
    return costs.length ? Math.min(...costs) : WEIGHTS.unknownTransfer;
  };

  const pinnedOk = (seq: string[], next: string): boolean => {
    const pinnedPlaces = pinOrder.map((p) => p.placeId);
    if (!pinnedPlaces.includes(next)) return true;
    const idx = pinnedPlaces.indexOf(next);
    for (let i = 0; i < idx; i++) if (pinnedPlaces[i] !== next && !seq.includes(pinnedPlaces[i]!)) return false;
    for (let i = idx + 1; i < pinnedPlaces.length; i++) if (pinnedPlaces[i] !== next && seq.includes(pinnedPlaces[i]!)) return false;
    return true;
  };

  const structural = (seq: string[]) => {
    let moves = (seq.length - 1) * pace.changePenalty;
    let transfers = 0;
    for (let i = 1; i < seq.length; i++) {
      const c = transferCost(seq[i - 1]!, seq[i]!);
      if (c === null) return null;
      transfers += c;
    }
    const g1 = gatewayCost(seq[0]!, req.arrivalGatewayId);
    const g2 = gatewayCost(seq[seq.length - 1]!, req.departureGatewayId);
    if (g1 === null || g2 === null) return null;
    const variety = varietyBonus(seq.map((id) => nodes.get(id)!.catalogue).filter((p): p is CataloguePlace => Boolean(p)), req.profile);
    moves = Math.round(moves * 1e9) / 1e9;
    return { moves, transfers, gateway: g1 + g2, variety };
  };

  const minLo = Math.min(...[...nodes.values()].map((n) => n.lo));
  const kMax = Math.min(req.maxStops ?? 8, nodes.size, Math.max(1, Math.floor(N / Math.max(1, minLo))));
  const kMin = Math.max(1, required.size);

  const evaluate = (seq: string[]): Evaluated | null => {
    const s = structural(seq);
    if (!s) return null;
    const specs: StopSpec[] = seq.map((id) => {
      const n = nodes.get(id)!;
      return { placeId: id, lo: n.lo, hi: n.hi, value: n.value, tags: n.tags, pins: n.pins.map((p) => ({ first: offset(p.firstNight), last: offset(p.lastNight), exact: p.exact })) };
    });
    const alloc = allocateNights(
      specs,
      N,
      req.consecutive.map((c) => ({ tag: c.tag, min: c.minimumNights })),
      req.fullDays.map((f) => ({ tag: f.tag, min: f.minimumDays })),
    );
    if (!alloc) return null;
    const total = alloc.utility + s.variety - s.moves - s.transfers - s.gateway;
    return { seq, nights: alloc.nights, score: { total, enjoyment: alloc.utility, variety: s.variety, movesPenalty: s.moves, transferPenalty: s.transfers, gatewayPenalty: s.gateway } };
  };

  const complete: Evaluated[] = [];
  const seen = new Set<string>();
  const consider = (seq: string[]) => {
    const key = seq.join('>');
    if (seen.has(key)) return;
    seen.add(key);
    const e = evaluate(seq);
    if (e) complete.push(e);
  };

  if (options.sequence) {
    if (options.sequence.every((id) => nodes.has(id))) consider(options.sequence);
  } else {
    const partialScore = (seq: string[]) => {
      const s = structural(seq);
      if (!s) return null;
      let u = 0;
      for (const id of seq) {
        const n = nodes.get(id)!;
        u += nightsUtility(n.value, n.ideal);
      }
      return u + s.variety - s.moves - s.transfers - s.gateway;
    };
    // Every final route must contain the required places, so partial routes that already hold
    // them rank first. This constant never changes the order of complete routes.
    const REQUIRED_BONUS = 10;
    const ranked = (seq: string[], p: number) => p + REQUIRED_BONUS * seq.filter((id) => required.has(id)).length;
    let beam: Candidate[] = [];
    const ids = [...nodes.keys()].sort();
    for (const id of ids) {
      if (!pinnedOk([], id)) continue;
      const p = partialScore([id]);
      if (p !== null) beam.push({ seq: [id], partial: ranked([id], p) });
    }
    for (let depth = 1; depth <= kMax && beam.length; depth++) {
      beam.sort((a, b) => b.partial - a.partial || a.seq.join('>').localeCompare(b.seq.join('>')));
      beam = beam.slice(0, BEAM_WIDTH);
      const completions = beam.filter((c) => c.seq.length >= kMin && [...required].every((r) => c.seq.includes(r)));
      for (const c of completions.slice(0, DP_PER_LEVEL)) consider(c.seq);
      if (depth === kMax) break;
      const next: Candidate[] = [];
      for (const c of beam) {
        const missing = [...required].filter((r) => !c.seq.includes(r)).length;
        for (const id of ids) {
          if (c.seq.includes(id) || !pinnedOk(c.seq, id)) continue;
          const seq = [...c.seq, id];
          const stillMissing = missing - (required.has(id) ? 1 : 0);
          if (stillMissing > kMax - seq.length) continue;
          const p = partialScore(seq);
          if (p !== null) next.push({ seq, partial: ranked(seq, p) });
        }
      }
      beam = next;
    }
  }

  if (!complete.length) {
    return empty(req, explainInfeasible(req, N, nodes, required));
  }
  complete.sort((a, b) => b.score.total - a.score.total || a.seq.join('>').localeCompare(b.seq.join('>')));
  const best = complete[0]!;
  const shown = new Set([best.seq.join('>'), [...best.seq].reverse().join('>')]);
  const distinct = complete.slice(1).filter((alt) => {
    const k = alt.seq.join('>');
    if (shown.has(k)) return false;
    shown.add(k);
    shown.add([...alt.seq].reverse().join('>'));
    return true;
  });
  const alternatives: Alternative[] = distinct.slice(0, 3).map((alt) => ({
    places: alt.seq,
    scoreDelta: Math.round((alt.score.total - best.score.total) * 100) / 100,
    summary: alt.seq.map((id, i) => `${nodes.get(id)!.name} ${alt.nights[i]}`).join(' · '),
  }));
  return buildItinerary(req, best, nodes, graph, alternatives, month);
}

function basicConflicts(req: PlanRequest, N: number): Conflict[] {
  const out: Conflict[] = [];
  if (N <= 0) out.push({ title: 'Dates', explanation: 'The day you leave must be after your first night.', relaxations: ['Change the dates.'], constraintIds: [] });
  if (N > MAX_PLAN_NIGHTS) out.push({ title: 'Trip too long for automatic planning', explanation: `Automatic planning covers up to ${MAX_PLAN_NIGHTS} nights; this trip has ${N}.`, relaxations: ['Plan part of the trip automatically and add the rest by hand.'], constraintIds: [] });
  if (compareDates(req.firstNight, req.departureDate) < 0) out.push({ title: 'Dates', explanation: 'Your first night away cannot be before you leave home.', relaxations: ['Change the dates.'], constraintIds: [] });
  if (req.homeDeadlineDate && compareDates(req.homeDeadlineDate, req.leaveDate) < 0) {
    out.push({
      title: 'Home deadline before the trip ends',
      explanation: `You must be home by ${formatDate(req.homeDeadlineDate)}, but the plan leaves its last stop on ${formatDate(req.leaveDate)}.`,
      relaxations: [`Leave the last stop by ${formatDate(addDays(req.homeDeadlineDate, -1))} or earlier.`, 'Move the home deadline, if it is really flexible.'],
      constraintIds: [],
    });
  }
  for (const pin of req.pins) {
    if (compareDates(pin.firstNight, req.firstNight) < 0 || compareDates(pin.lastNight, req.leaveDate) >= 0) {
      out.push({ title: 'Commitment outside the trip dates', explanation: `${pin.reason} needs nights ${formatDate(pin.firstNight)}–${formatDate(pin.lastNight)}, outside ${formatDate(req.firstNight)} to ${formatDate(req.leaveDate)}.`, relaxations: ['Extend the trip dates.', 'Or remove that commitment.'], constraintIds: [pin.sourceId] });
    }
  }
  const sorted = [...req.pins].sort((a, b) => compareDates(a.firstNight, b.firstNight));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (a.placeId !== b.placeId && compareDates(b.firstNight, a.lastNight) <= 0) {
        out.push({ title: 'Two commitments need different places on the same night', explanation: `${a.reason} and ${b.reason} overlap around ${formatDate(b.firstNight)}. Neither has been unlocked.`, relaxations: [`Move or drop: ${a.reason}.`, `Move or drop: ${b.reason}.`], constraintIds: [a.sourceId, b.sourceId] });
      }
    }
  }
  for (const r of req.requiredPlaceIds) if (req.excludedPlaceIds.includes(r)) out.push({ title: 'Contradiction', explanation: `${r} is both required and excluded.`, relaxations: ['Remove one of them.'], constraintIds: [] });
  return out;
}

function explainInfeasible(req: PlanRequest, N: number, nodes: Map<string, Node>, required: Set<string>): Conflict[] {
  const out: Conflict[] = [];
  const reqNodes = [...required].map((id) => nodes.get(id)!);
  const minReq = reqNodes.reduce((s, n) => s + n.lo, 0);
  if (minReq > N) {
    const biggest = [...reqNodes].sort((a, b) => b.lo - a.lo)[0]!;
    out.push({
      title: 'Not enough nights for the required places',
      explanation: `Your required places need at least ${minReq} nights together; the trip has ${N}.`,
      relaxations: [`Add ${minReq - N} night${minReq - N === 1 ? '' : 's'} to the trip.`, `Drop ${biggest.name} or lower its minimum (${biggest.lo} nights).`],
      constraintIds: [],
    });
  }
  for (const c of req.consecutive) {
    const nonQualifying = reqNodes.filter((n) => !n.tags.includes(c.tag)).reduce((s, n) => s + n.lo, 0);
    const room = N - nonQualifying;
    if (c.minimumNights > room) {
      out.push({
        title: `${c.minimumNights} consecutive ${c.tag} nights do not fit`,
        explanation: `After the other required places there are ${Math.max(0, room)} nights left.`,
        relaxations: [`Lower the minimum to ${Math.max(0, room)} nights.`, `Add ${c.minimumNights - room} nights to the trip.`],
        constraintIds: [c.anchorId],
      });
    }
  }
  for (const f of req.fullDays) {
    const room = N - reqNodes.filter((n) => !n.tags.includes(f.tag)).reduce((s, n) => s + n.lo, 0) - 1;
    if (f.minimumDays > room) {
      out.push({ title: `${f.minimumDays} full ${f.tag} days do not fit`, explanation: `Arrival and transfer days do not count, so at most about ${Math.max(0, room)} full days are possible.`, relaxations: [`Lower it to ${Math.max(0, room)}.`, 'Add nights to the trip.'], constraintIds: [f.anchorId] });
    }
  }
  if (!out.length) {
    out.push({
      title: 'No route meets every requirement',
      explanation: 'The combination of required places, fixed dates and night minimums has no valid order within the documented routes.',
      relaxations: ['Remove one required place.', 'Unlock one fixed date.', 'Lengthen the trip by a couple of nights.'],
      constraintIds: [],
    });
  }
  return out;
}

function bufferFor(pack: DestinationPack, mode: string) {
  if (mode.includes('flight')) return pack.defaultBuffers.flight ?? { pre: 120, post: 45 };
  if (mode.includes('ferry') || mode.includes('boat')) return pack.defaultBuffers.ferry ?? { pre: 45, post: 30 };
  return pack.defaultBuffers.default ?? { pre: 30, post: 20 };
}

function buildItinerary(req: PlanRequest, best: Evaluated, nodes: Map<string, Node>, graph: RouteGraph, alternatives: Alternative[], month: number): PlanResult {
  const pack = req.pack;
  const placeName = (id: string) => nodes.get(id)?.name ?? (id === req.home.id ? req.home.name : id);
  const stops: StopPlan[] = [];
  const stays: Stay[] = [];
  const claims: Claim[] = [];
  const places: Place[] = [];
  const unresolved: string[] = [];
  let cursor = req.firstNight;
  const consecutiveStops = new Set<string>();
  for (const c of req.consecutive) {
    let run: string[] = [];
    let bestRun: string[] = [];
    let runN = 0;
    let bestN = 0;
    best.seq.forEach((id, i) => {
      if (nodes.get(id)!.tags.includes(c.tag)) {
        run.push(id);
        runN += best.nights[i]!;
        if (runN > bestN) {
          bestN = runN;
          bestRun = [...run];
        }
      } else {
        run = [];
        runN = 0;
      }
    });
    if (bestN >= c.minimumNights) for (const id of bestRun) consecutiveStops.add(id);
  }

  best.seq.forEach((id, i) => {
    const node = nodes.get(id)!;
    const nights = best.nights[i]!;
    const checkIn = cursor;
    const checkOut = addDays(checkIn, nights);
    cursor = checkOut;
    const reasons: string[] = [];
    if (node.matched.length) reasons.push(`Strong for ${listWords(node.matched.slice(0, 3).map((m) => INTEREST_WORDS[m]))}.`);
    if (req.requiredPlaceIds.includes(id)) reasons.push('You asked for it.');
    for (const pin of node.pins) reasons.push(`Holds ${pin.reason}.`);
    if (consecutiveStops.has(id)) reasons.push('Part of your consecutive beach nights.');
    if (node.catalogue && nights === node.catalogue.recommendedNights.ideal) reasons.push(`${nights} nights is a comfortable length here.`);
    if (node.seasonNote) reasons.push(node.seasonNote);
    if (!node.catalogue) reasons.push('Outside the catalogue: plan these days yourself.');
    const locked = req.lockedStays.find((s) => s.placeId === id && s.checkIn === checkIn && s.checkOutExclusive === checkOut);
    const stay: Stay = locked
      ? { ...locked }
      : { id: `stay_${i + 1}_${id}`, placeId: id, checkIn, checkOutExclusive: checkOut, purposeTags: node.tags.slice(0, 4), lockedFields: [], accommodation: null, reason: reasons.join(' ') };
    if (locked) stay.reason = reasons.join(' ');
    stays.push(stay);
    stops.push({ placeId: id, checkIn, checkOutExclusive: checkOut, nights, reasons });
    if (node.catalogue) {
      const p = node.catalogue;
      places.push({ id: p.id, name: p.name, timeZone: p.timeZone, tags: p.tags, dataKind: 'curated', catalogueId: p.id, country: p.country, coordinates: null });
      claims.push({
        id: `claim_place_${p.id}`,
        subjectId: p.id,
        kind: 'place_info',
        evidenceStatus: 'source_documented',
        sourceUrl: p.sourceUrls[0]!,
        checkedAt: p.checkedAt,
        dataKind: 'curated',
        dependsOn: { placeId: p.id },
        note: p.summary,
      });
    }
  });

  const legs: TravelLeg[] = [];
  const first = nodes.get(best.seq[0]!)!;
  const last = nodes.get(best.seq[best.seq.length - 1]!)!;
  const gatewayFor = (n: Node, chosen: string | null) => {
    if (!n.catalogue) return null;
    if (chosen) return chosen === n.id ? null : chosen;
    if (n.gateway === 'major') return null;
    const majors = pack.places.filter((p) => p.gateway === 'major');
    const options = majors.map((m) => ({ m, t: graph.get(m.id, n.id) })).filter((x) => x.t).sort((a, b) => a.t!.typicalMinutes - b.t!.typicalMinutes || a.m.id.localeCompare(b.m.id));
    return options[0]?.m.id ?? null;
  };
  const inbound = gatewayFor(first, req.arrivalGatewayId);
  const outbound = gatewayFor(last, req.departureGatewayId);
  const airportOf = (id: string | null, n: Node) => (id ? pack.places.find((p) => p.id === id)?.airports[0] : n.catalogue?.airports[0]);
  const fb = bufferFor(pack, 'flight');
  legs.push({
    id: 'leg_home_out',
    fromPlaceId: req.home.id,
    toPlaceId: first.id,
    mode: inbound ? `flight to ${placeName(inbound)}, then onward` : 'flight',
    departure: null,
    arrival: null,
    durationRangeMinutes: null,
    preDepartureBufferMinutes: fb.pre,
    postArrivalBufferMinutes: fb.post,
    timingStatus: 'unknown',
    identifiers: airportOf(inbound, first) ? { to: airportOf(inbound, first) } : null,
    evidenceIds: [],
    lockedFields: [],
    note: inbound
      ? `Long-haul journey: add your flight times. ${first.name} is usually reached via ${placeName(inbound)}${describeTransfer(graph.get(inbound, first.id))}.`
      : 'Long-haul journey: add your flight times so connections and the home deadline can be checked.',
  });
  for (let i = 1; i < best.seq.length; i++) {
    const a = best.seq[i - 1]!;
    const b = best.seq[i]!;
    const legId = `leg_${i}_${a}_${b}`;
    const departureDate = stays[i - 1]!.checkOutExclusive;
    const t = nodes.get(a)!.catalogue && nodes.get(b)!.catalogue ? graph.get(a, b) : null;
    if (!t) {
      legs.push({ id: legId, fromPlaceId: a, toPlaceId: b, mode: 'to be decided', departure: null, arrival: null, durationRangeMinutes: null, preDepartureBufferMinutes: 60, postArrivalBufferMinutes: 30, timingStatus: 'unknown', identifiers: null, evidenceIds: [], lockedFields: [], note: `Outside the catalogue: add this journey yourself (on ${formatDate(departureDate)}).` });
      continue;
    }
    const path = [a, ...t.via, b];
    const modes = t.hops.map((h) => h.mode);
    const mode = t.via.length ? `${modes.join(' + ')} via ${t.via.map(placeName).join(', ')}` : modes[0]!;
    const buf = bufferFor(pack, mode);
    const evidenceIds: string[] = [];
    t.hops.forEach((hop, h) => {
      const cid = `claim_route_${legId}_${h + 1}`;
      evidenceIds.push(cid);
      claims.push({
        id: cid,
        subjectId: legId,
        kind: 'route_existence',
        evidenceStatus: 'source_documented',
        sourceUrl: hop.sourceUrls[0]!,
        checkedAt: hop.checkedAt,
        dataKind: 'curated',
        dependsOn: { fromPlaceId: a, toPlaceId: b },
        note: `${hop.mode} between ${placeName(path[h]!)} and ${placeName(path[h + 1]!)} is a documented way to travel. ${formatMinutes(hop.durationMinutes.min)}–${formatMinutes(hop.durationMinutes.max)} is a planning estimate, not a timetable. ${hop.note}`,
      });
    });
    legs.push({
      id: legId,
      fromPlaceId: a,
      toPlaceId: b,
      mode,
      departure: null,
      arrival: null,
      durationRangeMinutes: { min: t.minMinutes, max: t.maxMinutes },
      preDepartureBufferMinutes: buf.pre,
      postArrivalBufferMinutes: buf.post,
      timingStatus: 'planning_assumption',
      identifiers: null,
      evidenceIds,
      lockedFields: [],
      note: `Planned for ${formatDate(departureDate)}. Check a current timetable before booking.`,
    });
  }
  legs.push({
    id: 'leg_home_return',
    fromPlaceId: last.id,
    toPlaceId: req.home.id,
    mode: outbound ? `onward to ${placeName(outbound)}, then flight` : 'flight',
    departure: null,
    arrival: null,
    durationRangeMinutes: null,
    preDepartureBufferMinutes: fb.pre,
    postArrivalBufferMinutes: fb.post,
    timingStatus: 'unknown',
    identifiers: airportOf(outbound, last) ? { from: airportOf(outbound, last) } : null,
    evidenceIds: [],
    lockedFields: [],
    note: outbound
      ? `Return journey: add your times. From ${last.name}, travel to ${placeName(outbound)}${describeTransfer(graph.get(last.id, outbound))} for the flight home.`
      : 'Return journey: add your times so the home deadline can be checked.',
  });

  for (const locked of req.lockedLegs) {
    const i = legs.findIndex((l) => l.fromPlaceId === locked.fromPlaceId && l.toPlaceId === locked.toPlaceId);
    if (i >= 0) legs[i] = { ...locked };
  }
  const { activities, notes } = planActivities(req, best, stays, nodes, claims);
  unresolved.push('Long-haul and onward journeys have no times yet, so connections and the home deadline stay unresolved until you add them.');
  unresolved.push('Travel times between stops are planning estimates from the documented routes, not timetables or fares.');
  unresolved.push('No prices are included. Add allowances or quotes in Budget.');
  unresolved.push(...notes);
  for (const id of best.seq) {
    const n = nodes.get(id)!;
    if (!n.catalogue) unresolved.push(`${n.name} is your own place, outside the ${pack.title} catalogue: its journeys, activities and evidence are yours to add.`);
  }
  if (req.profile.accessibility.stepFreeNeeded) unresolved.push('Step-free access is not verified for most places and activities in this pack. Check each one directly.');

  const matchedAll = new Set(best.seq.flatMap((id) => nodes.get(id)!.matched));
  const top = (Object.keys(req.profile.weights) as Interest[])
    .filter((i) => matchedAll.has(i))
    .sort((a, b) => req.profile.weights[b] - req.profile.weights[a] || a.localeCompare(b))
    .slice(0, 4);
  const reasons: string[] = [];
  if (top.length) reasons.push(`Built around ${listWords(top.map((m) => INTEREST_WORDS[m]))}, which you rated highly.`);
  reasons.push(`${best.seq.length} stop${best.seq.length === 1 ? '' : 's'}, so ${best.seq.length - 1} change${best.seq.length - 1 === 1 ? '' : 's'} of accommodation at a ${req.profile.pace} pace.`);
  const transferMins = legs.reduce((s, l) => s + (l.durationRangeMinutes ? (l.durationRangeMinutes.min + l.durationRangeMinutes.max) / 2 : 0), 0);
  if (transferMins) reasons.push(`About ${formatMinutes(Math.round(transferMins / 30) * 30)} of travel between stops (planning estimate).`);
  if (inbound) reasons.push(`Arrive through ${placeName(inbound)}, then continue to ${first.name}.`);
  for (const c of req.consecutive) {
    const nightsAtTag = best.seq.reduce((s, id, i) => s + (nodes.get(id)!.tags.includes(c.tag) && consecutiveStops.has(id) ? best.nights[i]! : 0), 0);
    if (nightsAtTag) reasons.push(`${nightsAtTag} consecutive ${c.tag} nights (you asked for at least ${c.minimumNights}).`);
  }
  const monthName = formatDate(`2030-${String(month).padStart(2, '0')}-01`, { weekday: false }).split(' ')[1];
  const seasonal = best.seq.filter((id) => nodes.get(id)!.seasonNote);
  if (seasonal.length) reasons.push(`Season check for ${monthName}: ${seasonal.map(placeName).join(', ')} may be wetter then (approximate guidance).`);
  else reasons.push(`No stop is in its usual wetter months in ${monthName} (approximate guidance).`);

  const summary = `${nightsBetween(req.firstNight, req.leaveDate)} nights, ${best.seq.length} stop${best.seq.length === 1 ? '' : 's'}: ${best.seq.map((id, i) => `${placeName(id)} ${best.nights[i]}`).join(' · ')}.`;
  return {
    status: 'ok',
    stops,
    places,
    stays,
    travelLegs: legs,
    activities,
    claims,
    summary,
    reasons,
    unresolved,
    conflicts: [],
    alternatives,
    score: roundScore(best.score),
    coverage: { packId: pack.packId, packTitle: pack.title, version: pack.version, outside: [] },
  };
}

function roundScore(s: ScoreBreakdown): ScoreBreakdown {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { total: r(s.total), enjoyment: r(s.enjoyment), variety: r(s.variety), movesPenalty: r(s.movesPenalty), transferPenalty: r(s.transferPenalty), gatewayPenalty: r(s.gatewayPenalty) };
}

function describeTransfer(t: Transfer | null): string {
  if (!t) return '';
  return ` (${t.hops.map((h) => h.mode).join(' + ')}, about ${formatMinutes(t.minMinutes)}–${formatMinutes(t.maxMinutes)}, planning estimate)`;
}

const PARTS: PartOfDay[] = ['morning', 'afternoon', 'evening'];

function planActivities(req: PlanRequest, best: Evaluated, stays: Stay[], nodes: Map<string, Node>, claims: Claim[]) {
  const pace = PACE[req.profile.pace];
  const notes: string[] = [];
  const within = (a: Activity) => {
    const d = a.start ? a.start.localDateTime.slice(0, 10) : a.date;
    return Boolean(d) && stays.some((s) => s.placeId === a.placeId && compareDates(s.checkIn, d!) <= 0 && compareDates(d!, s.checkOutExclusive) <= 0);
  };
  const activities: Activity[] = [...req.keptActivities, ...req.userActivities.filter(within)];
  const blocked = new Set<string>();
  for (const a of activities) {
    const d = a.start ? a.start.localDateTime.slice(0, 10) : a.date;
    if (d) blocked.add(d);
  }
  for (const pin of req.pins) if (!pin.exact) for (const d of datesInRange(addDays(pin.firstNight, 1), addDays(pin.lastNight, 1))) blocked.add(d);
  // Enough downtime: with recovery protected, no morning plans after a late night.
  const noMorning = recoveryMornings({ activities, profile: req.profile });
  const byPlace = new Map<string, CatalogueActivity[]>();
  for (const a of req.pack.activities) {
    const list = byPlace.get(a.placeId) ?? [];
    list.push(a);
    byPlace.set(a.placeId, list);
  }
  best.seq.forEach((placeId, i) => {
    const node = nodes.get(placeId)!;
    const stay = stays[i]!;
    if (!node.catalogue) return;
    const interior = datesInRange(addDays(stay.checkIn, 1), stay.checkOutExclusive).filter((d) => !blocked.has(d));
    const slots = Math.round(interior.length * pace.activitiesPerFullDay);
    const used = new Map<string, Set<PartOfDay>>();
    const candidates = (byPlace.get(placeId) ?? [])
      .map((a) => ({ a, allowed: activityAllowed(a, req.profile), score: activityScore(a, req.profile) }))
      .sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id));
    let placed = 0;
    for (const { a, allowed } of candidates) {
      if (a.recurrence) {
        if (allowed.ok && a.tags.some((t) => req.profile.weights[t] >= 2)) {
          notes.push(`${a.title}: ${a.recurrence.note} Your ${node.name} dates are ${formatDate(stay.checkIn)} to ${formatDate(stay.checkOutExclusive)}. Not scheduled.`);
        }
        continue;
      }
      if (!allowed.ok || placed >= slots) continue;
      const fullDay = a.partOfDay === 'any' && a.durationHours.min >= 6;
      const lateNight = req.profile.protectRecoveryTime && a.partOfDay === 'night';
      let chosen: { date: string; part: PartOfDay; load: number } | null = null;
      let dayMismatch = false;
      // Spread activities: prefer the least-busy valid day, then the earliest.
      for (const date of interior) {
        if (a.daysOfWeek && !a.daysOfWeek.includes(dayOfWeek(date))) {
          dayMismatch = true;
          continue;
        }
        const taken = used.get(date) ?? new Set<PartOfDay>();
        const parts = new Set<PartOfDay>(taken);
        if (noMorning.has(date)) parts.add('morning');
        if (lateNight) {
          const nextDay = used.get(addDays(date, 1));
          if (nextDay && (nextDay.has('morning') || nextDay.has('any'))) continue;
        }
        let part: PartOfDay | undefined;
        if (fullDay) part = parts.size === 0 ? 'any' : undefined;
        else if (!parts.has('any') && parts.size < 2) {
          const preferred: PartOfDay = a.partOfDay === 'night' ? 'evening' : a.partOfDay;
          part = preferred === 'any' ? PARTS.find((p) => !parts.has(p)) : parts.has(preferred) ? undefined : preferred;
        }
        if (part && (!chosen || taken.size < chosen.load)) chosen = { date, part, load: taken.size };
      }
      if (!chosen) {
        if (dayMismatch && a.distinctive >= 2) {
          const dayNames = (a.daysOfWeek ?? []).map((d) => ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][d - 1]).join(' and ');
          notes.push(`${a.title} happens on ${dayNames}; none of your free days in ${node.name} falls on one.`);
        }
        continue;
      }
      const parts = used.get(chosen.date) ?? new Set<PartOfDay>();
      parts.add(chosen.part);
      used.set(chosen.date, parts);
      if (lateNight) noMorning.add(addDays(chosen.date, 1));
      const id = `act_${i + 1}_${a.id}`;
      const claimId = `claim_act_${id}`;
      claims.push({
        id: claimId,
        subjectId: id,
        kind: 'activity_info',
        evidenceStatus: 'source_documented',
        sourceUrl: a.sourceUrls[0]!,
        checkedAt: a.checkedAt,
        dataKind: 'curated',
        dependsOn: { placeId },
        note: a.schedulingNote ? `${a.summary} ${a.schedulingNote}` : a.summary,
      });
      activities.push({
        id,
        placeId,
        title: a.title,
        start: null,
        end: null,
        date: chosen.date,
        partOfDay: a.partOfDay === 'night' ? 'night' : chosen.part,
        durationMinutes: { min: Math.round(a.durationHours.min * 60), max: Math.round(a.durationHours.max * 60) },
        daysOfWeek: a.daysOfWeek ? [...a.daysOfWeek] : null,
        tags: [...a.tags],
        lockedFields: [],
        dataKind: 'curated',
        catalogueActivityId: a.id,
        evidenceIds: [claimId],
        note: null,
      });
      placed++;
    }
  });
  return { activities, notes };
}
