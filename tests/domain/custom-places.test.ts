import { describe, expect, it } from 'vitest';
import { createTrip, defaultNewTripInput } from '../../src/application/newTrip';
import { makeProposal, previewProposal } from '../../src/application/proposal';
import { evaluateConstraints, legFeasibility } from '../../src/domain/constraints';
import { customPlaceId } from '../../src/domain/places';
import type { Place, TripDocument } from '../../src/domain/schema';

function emptyTrip(): TripDocument {
  const input = defaultNewTripInput('2030-01-01', 'Europe/London');
  Object.assign(input, { departureDate: '2031-03-01', firstNight: '2031-03-02', leaveDate: '2031-03-08', homeBy: null, title: 'Custom test', homeName: 'Home' });
  return createTrip(input, 'custom_trip');
}
const isle = (doc: TripDocument): Place => ({ id: customPlaceId(doc, 'Example Isle (fictional)', 'Pacific/Auckland'), name: 'Example Isle (fictional)', timeZone: 'Pacific/Auckland', tags: ['beach'], dataKind: 'user', catalogueId: null });

describe('manual custom places', () => {
  it('gives each distinct custom place its own id and reuses identical ones', () => {
    const doc = emptyTrip();
    const a = customPlaceId(doc, 'Example Isle', 'Pacific/Auckland');
    doc.places.push({ id: a, name: 'Example Isle', timeZone: 'Pacific/Auckland', tags: [], dataKind: 'user', catalogueId: null });
    expect(customPlaceId(doc, 'example isle', 'Pacific/Auckland')).toBe(a);
    expect(customPlaceId(doc, 'Example Isle', 'Europe/Lisbon')).toBe(`${a}_2`);
  });

  it('can hold a stay, gets honest placeholder journeys, and takes times in its own zone', () => {
    let doc = emptyTrip();
    const place = isle(doc);
    const add = previewProposal(doc, makeProposal(doc, 'add', [{ type: 'AddStay', place, stay: { id: 's1', placeId: place.id, checkIn: '2031-03-02', checkOutExclusive: '2031-03-08', purposeTags: ['beach'], lockedFields: [] } }]));
    expect(add.canApply).toBe(true);
    doc = { ...add.next!, revision: 2 };
    const legs = doc.travelLegs;
    expect(legs.map((l) => [l.fromPlaceId, l.toPlaceId])).toEqual([
      ['home', place.id],
      [place.id, 'home'],
    ]);
    expect(legs.every((l) => l.mode === 'to be decided' && l.timingStatus === 'unknown')).toBe(true);
    expect(evaluateConstraints(doc).filter((r) => r.id.startsWith('leg:')).every((r) => r.status === 'unresolved')).toBe(true);

    const timed = previewProposal(doc, makeProposal(doc, 'times', [
      { type: 'UpdateTravelLeg', legId: legs[1]!.id, patch: { mode: 'ferry then flight', departure: { localDateTime: '2031-03-08T10:00', timeZone: 'Pacific/Auckland' }, arrival: { localDateTime: '2031-03-09T07:00', timeZone: 'Europe/London' } } },
    ]));
    const leg = timed.next!.travelLegs[1]!;
    expect(leg.timingStatus).toBe('user_entered');
    expect(legFeasibility(leg)).toMatchObject({ status: 'satisfied', claimFeasible: true });
    // 10:00 NZDT (UTC+13) to 07:00 GMT next day but one is 34 hours.
    expect(legFeasibility(leg).message).toContain('34 h');
  });
});
