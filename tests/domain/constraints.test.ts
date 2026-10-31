import { describe, expect, it } from 'vitest';
import { evaluateConstraints, legFeasibility } from '../../src/domain/constraints';
import type { TripDocument } from '../../src/domain/schema';
import { demoTrip, preview, result } from '../helpers/fixtures';

describe('constraints on the fictional demo', () => {
  it('starts with every hard commitment satisfied', () => {
    const doc = demoTrip();
    const r = evaluateConstraints(doc);
    for (const id of ['anchor_event', 'anchor_beach', 'anchor_home', 'anchor_recovery']) {
      expect(r.find((x) => x.anchorId === id)?.status, id).toBe('satisfied');
    }
    expect(r.find((x) => x.anchorId === 'anchor_home')?.explanation).toContain('22:00');
  });

  it('C02: shortening the beach block is blocked and the accepted plan is untouched', () => {
    const doc = demoTrip();
    const before = JSON.stringify(doc);
    const p = preview(doc, [{ type: 'ChangeStayDates', stayId: 'stay_cliff', checkOutExclusive: '2030-06-29' }]);
    expect(result(p, 'anchor_beach')?.status).toBe('violated');
    expect(p.canApply).toBe(false);
    expect(p.status).toBe('blocked');
    expect(JSON.stringify(doc)).toBe(before);
    expect(doc.revision).toBe(1);
    expect(p.after.some((r) => r.id.startsWith('gap:'))).toBe(true);
  });

  it('C04 / A03: arriving home on 2 July fails even though the flight leaves on 1 July', () => {
    const doc = demoTrip();
    const p = preview(doc, [{ type: 'UpdateTravelLeg', legId: 'leg_return', patch: { arrival: { localDateTime: '2030-07-02T00:30', timeZone: 'Europe/London' } } }]);
    expect(result(p, 'anchor_home')?.status).toBe('violated');
    expect(p.canApply).toBe(false);
  });

  it('C05: a post-arrival transfer can miss the deadline', () => {
    const doc = demoTrip();
    const p = preview(doc, [{ type: 'UpdateTravelLeg', legId: 'leg_return', patch: { arrival: { localDateTime: '2030-07-01T22:30', timeZone: 'Europe/London' } } }]);
    const r = result(p, 'anchor_home');
    expect(r?.status).toBe('violated');
    expect(r?.explanation).toContain('23:30');
  });

  it('C18 / A02: leaving the event location at midnight fails and names the whole interval', () => {
    const doc = demoTrip();
    const p = preview(doc, [{ type: 'UpdateTravelLeg', legId: 'leg_lantern_market', patch: { departure: { localDateTime: '2030-06-14T00:00', timeZone: 'Asia/Bangkok' } } }]);
    const r = result(p, 'anchor_event');
    expect(r?.status).toBe('violated');
    expect(r?.explanation).toContain('13 Jun 20:00');
    expect(r?.explanation).toContain('14 Jun 02:00');
    expect(p.canApply).toBe(false);
  });

  it('C16: two locked events in different places at the same time stay visible, nothing unlocks', () => {
    const doc: TripDocument = demoTrip();
    doc.activities.push(
      { id: 'ev_a', placeId: 'market', title: 'Fictional event A', start: { localDateTime: '2030-06-16T18:00', timeZone: 'Asia/Bangkok' }, end: { localDateTime: '2030-06-16T20:00', timeZone: 'Asia/Bangkok' }, tags: [], lockedFields: ['start', 'end'], dataKind: 'synthetic' },
      { id: 'ev_b', placeId: 'harbour', title: 'Fictional event B', start: { localDateTime: '2030-06-16T19:00', timeZone: 'Asia/Singapore' }, end: { localDateTime: '2030-06-16T21:00', timeZone: 'Asia/Singapore' }, tags: [], lockedFields: ['start', 'end'], dataKind: 'synthetic' },
    );
    doc.anchors.push({ id: 'a_ev_a', kind: 'fixed_event', strength: 'hard', activityId: 'ev_a' }, { id: 'a_ev_b', kind: 'fixed_event', strength: 'hard', activityId: 'ev_b' });
    const r = evaluateConstraints(doc);
    const clash = r.find((x) => x.id.startsWith('event-clash:'));
    expect(clash?.status).toBe('violated');
    expect(clash?.explanation).toContain('two places at once');
    expect(doc.activities.filter((a) => a.lockedFields.length).length).toBeGreaterThanOrEqual(2);
  });

  it('C20: a leg with no times or duration is unresolved, never feasible', () => {
    const f = legFeasibility({ id: 'x', fromPlaceId: 'market', toPlaceId: 'garden', mode: 'rail', departure: null, arrival: null, durationRangeMinutes: null, preDepartureBufferMinutes: 0, postArrivalBufferMinutes: 0, timingStatus: 'unknown', evidenceIds: [] });
    expect(f).toMatchObject({ status: 'unresolved', claimFeasible: false });
  });

  it('A05: removing a hard commitment by an untrusted proposal is refused; preferences never unlock', () => {
    const doc = demoTrip();
    const p = preview(doc, [{ type: 'RemoveAnchor', anchorId: 'anchor_event' }], 'untrusted_proposal');
    expect(p.status).toBe('rejected');
    const nightlife = preview(doc, [{ type: 'SetPreferences', patch: { weights: { ...doc.profile.weights, nightlife: 3 } } }]);
    expect(nightlife.canApply).toBe(true);
    expect(nightlife.next?.activities.find((a) => a.id === 'activity_lantern_night')?.lockedFields).toEqual(['placeId', 'start', 'end']);
    const move = preview(doc, [{ type: 'UpdateActivity', activityId: 'activity_lantern_night', patch: { date: '2030-06-12' } }]);
    expect(move.status).toBe('rejected');
  });
});

describe('weekday-only activities', () => {
  it('flags, without blocking, an activity moved off the days its source gives', () => {
    const doc = demoTrip();
    doc.activities.find((a) => a.id === 'activity_food_walk')!.daysOfWeek = [7];
    const p = preview(doc, [{ type: 'UpdateActivity', activityId: 'activity_food_walk', patch: { date: '2030-06-17', start: null, end: null } }]);
    expect(p.canApply).toBe(true);
    const flag = p.newlyUnresolved.find((r) => r.id === 'weekday:activity_food_walk');
    expect(flag?.explanation).toContain('usually runs on Sundays');
  });
});
