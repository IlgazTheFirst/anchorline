import { describe, expect, it } from 'vitest';
import { DEFAULT_PACK } from '../../src/catalogue';
import { createTrip, defaultNewTripInput } from '../../src/application/newTrip';
import { makeProposal, previewProposal } from '../../src/application/proposal';
import { evaluateConstraints } from '../../src/domain/constraints';
import { longestBlock, qualifyingBlocks, totalHotelNights } from '../../src/domain/derive';
import { presetById } from '../../src/domain/presets';
import type { Anchor, TripDocument } from '../../src/domain/schema';
import { generatePlan } from '../../src/planner/generate';
import { buildPlanRequest, planForTrip, planToCommands } from '../../src/planner/fromTrip';
import { suggestSurprises, MAX_SURPRISES } from '../../src/planner/surprise';

function trip(nights: number, anchors: Anchor[], opts: { preset?: string; firstNight?: string; weights?: Partial<TripDocument['profile']['weights']> } = {}): TripDocument {
  const input = defaultNewTripInput('2030-01-01', 'Europe/London');
  const firstNight = opts.firstNight ?? '2031-02-02';
  input.departureDate = '2031-02-01';
  input.firstNight = firstNight;
  const leave = new Date(`${firstNight}T00:00:00Z`);
  leave.setUTCDate(leave.getUTCDate() + nights);
  input.leaveDate = leave.toISOString().slice(0, 10);
  input.homeBy = null;
  input.title = 'Test trip';
  input.homeName = 'Home';
  input.profile = structuredClone(presetById(opts.preset ?? 'a_bit_of_everything').profile);
  if (opts.weights) input.profile.weights = { ...input.profile.weights, ...opts.weights };
  const doc = createTrip(input, `trip_${nights}`);
  doc.anchors.push(...anchors);
  return doc;
}

const beach = (n: number): Anchor => ({ id: 'beach', kind: 'minimum_consecutive_nights', strength: 'hard', qualifyingTag: 'beach', minimumNights: n });

describe('deterministic planner', () => {
  it('C17 / A06: two new trips produce different valid allocations that keep each minimum', () => {
    const a = planForTrip(trip(12, [beach(4)], { weights: { culture: 3, city: 3 } }), DEFAULT_PACK).result!;
    const b = planForTrip(trip(18, [beach(7)], { preset: 'slow_and_easy' }), DEFAULT_PACK).result!;
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    const nights = (r: typeof a) => r.stays.reduce((s, x) => s + (Date.parse(x.checkOutExclusive) - Date.parse(x.checkIn)) / 864e5, 0);
    expect(nights(a)).toBe(12);
    expect(nights(b)).toBe(18);
    expect(a.summary).not.toBe(b.summary);
    for (const [r, min] of [[a, 4], [b, 7]] as const) {
      const block = longestBlock(qualifyingBlocks({ stays: r.stays, places: r.places }, 'beach'));
      expect(block?.nights ?? 0).toBeGreaterThanOrEqual(min);
    }
    expect(a.coverage.packTitle).toBe('Thailand & the Malay Peninsula');
    expect(a.travelLegs.every((l) => l.departure === null && l.arrival === null)).toBe(true);
    expect(a.travelLegs.filter((l) => l.timingStatus === 'planning_assumption').every((l) => l.durationRangeMinutes)).toBe(true);
    expect(a.claims.every((c) => c.evidenceStatus === 'source_documented' && c.sourceUrl?.startsWith('https://'))).toBe(true);
  });

  it('is deterministic for the same inputs and catalogue version', () => {
    const doc = trip(14, [beach(5)]);
    const one = planForTrip(doc, DEFAULT_PACK).result;
    const two = planForTrip(structuredClone(doc), DEFAULT_PACK).result;
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('responds to preferences, not just dates', () => {
    const party = planForTrip(trip(10, [], { weights: { nightlife: 3, beach: 3, culture: 0, nature: 0, city: 1 } }), DEFAULT_PACK).result!;
    const quiet = planForTrip(trip(10, [], { preset: 'quiet_evenings', weights: { nature: 3, culture: 3, beach: 0, nightlife: 0 } }), DEFAULT_PACK).result!;
    expect(party.stops.map((s) => s.placeId)).not.toEqual(quiet.stops.map((s) => s.placeId));
    expect(quiet.activities.some((a) => ['bkk_rooftop', 'hkt_bangla', 'kpn_full_moon'].includes(a.catalogueActivityId ?? ''))).toBe(false);
  });

  it('respects required, excluded and minimum-night places', () => {
    const doc = trip(14, [
      { id: 'req', kind: 'minimum_nights_at_place', strength: 'hard', placeId: 'chiang_mai', minimumNights: 4 },
      { id: 'exc', kind: 'excluded_place', strength: 'hard', placeId: 'bangkok' },
    ]);
    doc.places.push({ id: 'chiang_mai', name: 'Chiang Mai', timeZone: 'Asia/Bangkok', tags: ['city'], dataKind: 'curated', catalogueId: 'chiang_mai' }, { id: 'bangkok', name: 'Bangkok', timeZone: 'Asia/Bangkok', tags: ['city'], dataKind: 'curated', catalogueId: 'bangkok' });
    const r = planForTrip(doc, DEFAULT_PACK).result!;
    expect(r.status).toBe('ok');
    const cm = r.stops.find((s) => s.placeId === 'chiang_mai');
    expect(cm?.nights).toBeGreaterThanOrEqual(4);
    expect(r.stops.some((s) => s.placeId === 'bangkok')).toBe(false);
  });

  it('keeps a fixed event: the stop covers the event nights and the event stays locked', () => {
    const doc = trip(12, []);
    doc.places.push({ id: 'ko_pha_ngan', name: 'Ko Pha-ngan', timeZone: 'Asia/Bangkok', tags: ['beach'], dataKind: 'curated', catalogueId: 'ko_pha_ngan' });
    doc.activities.push({ id: 'ev', placeId: 'ko_pha_ngan', title: 'Fictional beach festival', start: { localDateTime: '2031-02-08T20:00', timeZone: 'Asia/Bangkok' }, end: { localDateTime: '2031-02-09T04:00', timeZone: 'Asia/Bangkok' }, tags: ['nightlife'], lockedFields: ['placeId', 'start', 'end'], dataKind: 'user' });
    doc.anchors.push({ id: 'ev_anchor', kind: 'fixed_event', strength: 'hard', activityId: 'ev', arrivalBufferMinutes: 120 });
    const r = planForTrip(doc, DEFAULT_PACK).result!;
    expect(r.status).toBe('ok');
    const stop = r.stays.find((s) => s.placeId === 'ko_pha_ngan')!;
    expect(stop.checkIn <= '2031-02-07').toBe(true);
    expect(stop.checkOutExclusive >= '2031-02-10').toBe(true);
    const preview = previewProposal(doc, makeProposal(doc, 'Generate', planToCommands(r), 'planner'));
    expect(preview.canApply).toBe(true);
    expect(preview.next!.activities.find((a) => a.id === 'ev')?.lockedFields).toEqual(['placeId', 'start', 'end']);
    const ev = evaluateConstraints(preview.next!).find((c) => c.anchorId === 'ev_anchor');
    expect(ev?.status).not.toBe('violated');
  });

  it('explains infeasible requirements with concrete relaxations instead of dropping them', () => {
    const doc = trip(6, [beach(9)]);
    const r = planForTrip(doc, DEFAULT_PACK).result!;
    expect(r.status).toBe('infeasible');
    expect(r.conflicts[0]!.relaxations.length).toBeGreaterThan(0);
    expect(r.conflicts.map((c) => c.title).join(' ')).toMatch(/beach/);
    const deadline = trip(10, [{ id: 'home', kind: 'arrival_deadline', strength: 'hard', placeId: 'home', deadline: { localDateTime: '2031-02-08T23:00', timeZone: 'Europe/London' }, includePostArrivalBuffer: true }]);
    const d = planForTrip(deadline, DEFAULT_PACK).result!;
    expect(d.status).toBe('infeasible');
    expect(d.conflicts[0]!.title).toMatch(/deadline/i);
  });

  it('A06: places outside the catalogue are reported, and manual planning still works', () => {
    const doc = trip(8, [{ id: 'req', kind: 'required_place', strength: 'hard', placeId: 'somewhere' }]);
    const built = buildPlanRequest(doc, DEFAULT_PACK);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const r = generatePlan({ ...built.request, customPlaces: [] });
    expect(r.status).toBe('infeasible');
    expect(r.coverage.outside).toEqual(['somewhere']);
    doc.places.push({ id: 'somewhere', name: 'A custom place', timeZone: 'Asia/Bangkok', tags: ['city'], dataKind: 'user' });
    const manual = previewProposal(doc, makeProposal(doc, 'add', [{ type: 'AddStay', stay: { id: 's1', placeId: 'somewhere', checkIn: '2031-02-02', checkOutExclusive: '2031-02-10', purposeTags: [], lockedFields: [] } }]));
    expect(manual.canApply).toBe(true);
    expect(totalHotelNights(manual.next!)).toBe(8);
  });

  it('applies through the normal pipeline and cannot certify anything', () => {
    const doc = trip(10, [beach(4)]);
    const r = planForTrip(doc, DEFAULT_PACK).result!;
    const commands = planToCommands(r);
    const sneaky = structuredClone(commands);
    if (sneaky[0]!.type === 'SetItinerary') sneaky[0]!.claims[0]!.evidenceStatus = 'live_quote';
    expect(previewProposal(doc, makeProposal(doc, 'x', sneaky, 'planner')).status).toBe('rejected');
    const ok = previewProposal(doc, makeProposal(doc, 'Generate', commands, 'planner'));
    expect(ok.status).toBe('ready');
    expect(totalHotelNights(ok.next!)).toBe(10);
  });

  it('A05: surprises are few, optional, avoid locked events and go through preview', () => {
    const doc = trip(14, [beach(4)]);
    const r = planForTrip(doc, DEFAULT_PACK).result!;
    const applied = previewProposal(doc, makeProposal(doc, 'Generate', planToCommands(r), 'planner')).next!;
    applied.revision = 2;
    const surprises = suggestSurprises(applied, DEFAULT_PACK);
    expect(surprises.length).toBeGreaterThan(0);
    expect(surprises.length).toBeLessThanOrEqual(MAX_SURPRISES);
    for (const s of surprises) {
      const p = previewProposal(applied, makeProposal(applied, s.title, s.commands, 'planner'));
      expect(p.canApply, s.title).toBe(true);
      expect(p.diff?.activities.filter((a) => a.change === 'added')).toHaveLength(1);
    }
    expect(JSON.stringify(suggestSurprises(applied, DEFAULT_PACK))).toBe(JSON.stringify(surprises));
  });

  it('never schedules a recurring event on a date it cannot verify', () => {
    const doc = trip(14, [{ id: 'req', kind: 'minimum_nights_at_place', strength: 'hard', placeId: 'ko_pha_ngan', minimumNights: 3 }], { weights: { nightlife: 3 } });
    doc.places.push({ id: 'ko_pha_ngan', name: 'Ko Pha-ngan', timeZone: 'Asia/Bangkok', tags: ['beach'], dataKind: 'curated', catalogueId: 'ko_pha_ngan' });
    const r = planForTrip(doc, DEFAULT_PACK).result!;
    expect(r.activities.some((a) => a.catalogueActivityId === 'kpn_full_moon')).toBe(false);
    expect(r.unresolved.join(' ')).toMatch(/full moon/i);
  });
});
