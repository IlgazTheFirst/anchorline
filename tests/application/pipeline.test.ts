import { describe, expect, it } from 'vitest';
import { budgetItemApplicability, claimApplicability } from '../../src/domain/claims';
import { budgetSummaryFor } from '../../src/domain/money';
import { evaluateConstraints } from '../../src/domain/constraints';
import { makeProposal, previewProposal } from '../../src/application/proposal';
import { MemoryTripRepository } from '../../src/application/memoryRepository';
import { StaleProposalError } from '../../src/application/history';
import type { Place } from '../../src/domain/schema';
import { demoTrip, preview, result } from '../helpers/fixtures';

describe('command pipeline', () => {
  it('C03 / A08: replacing a city keeps dates, invalidates its route evidence and leaves an honest draft', () => {
    const doc = demoTrip();
    const garden = doc.places.find((p) => p.id === 'garden') as Place;
    const p = preview(doc, [{ type: 'ReplaceStop', stayId: 'stay_harbour', place: garden }]);
    expect(p.canApply).toBe(true);
    const next = p.next!;
    const stay = next.stays.find((s) => s.id === 'stay_harbour')!;
    expect(stay).toMatchObject({ placeId: 'garden', checkIn: '2030-06-18', checkOutExclusive: '2030-06-23' });
    expect(result(p, 'anchor_beach')?.status).toBe('satisfied');
    expect(result(p, 'anchor_event')?.status).toBe('satisfied');
    const inapplicable = next.claims.filter((c) => !claimApplicability(next, c).applicable).map((c) => c.id).sort();
    expect(inapplicable).toEqual(['claim_harbour_palm', 'claim_market_harbour']);
    expect(p.diff?.invalidatedEvidence.map((e) => e.id).sort()).toEqual(['claim_harbour_palm', 'claim_market_harbour']);
    const inbound = next.travelLegs.find((l) => l.toPlaceId === 'garden')!;
    expect(inbound.departure).toBeNull();
    expect(inbound.timingStatus).toBe('unknown');
    expect(p.after.find((r) => r.id === `leg:${inbound.id}`)?.status).toBe('unresolved');
  });

  it('A08: a dated quote for the old route stops counting once the city changes', () => {
    const doc = demoTrip();
    doc.budgetItems.push({ id: 'q1', subjectId: 'leg_market_harbour', label: 'Fictional quote', currency: 'GBP', minorUnitDigits: 2, unitAmountMinor: 9000, priceBasis: 'per_person', quantity: { people: 2 }, status: 'dated_quote', dependsOn: { fromPlaceId: 'market', toPlaceId: 'harbour' } });
    const garden = doc.places.find((p) => p.id === 'garden') as Place;
    const next = preview(doc, [{ type: 'ReplaceStop', stayId: 'stay_harbour', place: garden }]).next!;
    const item = next.budgetItems.find((b) => b.id === 'q1')!;
    expect(budgetItemApplicability(next, item).applicable).toBe(false);
    const s = budgetSummaryFor(next, (i) => budgetItemApplicability(next, i).applicable);
    expect(s.inapplicableItems.map((i) => i.id)).toEqual(['q1']);
    expect(s.grandTotal).toBeNull();
  });

  it('C14: a stale proposal is refused and the accepted document is unchanged', async () => {
    const repo = new MemoryTripRepository();
    const doc = await repo.create(demoTrip());
    const p1 = makeProposal(doc, 'one', [{ type: 'SetTripDetails', title: 'Fictional one' }]);
    const r1 = previewProposal(doc, p1);
    await repo.commit(doc.id, p1.baseRevision, r1.next!, 'one');
    const after1 = (await repo.get(doc.id))!.doc;
    const p2 = makeProposal(after1, 'two', [{ type: 'SetTripDetails', title: 'Fictional two' }]);
    await repo.commit(doc.id, p2.baseRevision, previewProposal(after1, p2).next!, 'two');
    const current = (await repo.get(doc.id))!.doc;
    expect(current.revision).toBe(3);
    const stale = previewProposal(current, { ...p1 });
    expect(stale.status).toBe('stale');
    await expect(repo.commit(doc.id, 1, r1.next!, 'stale')).rejects.toBeInstanceOf(StaleProposalError);
    expect((await repo.get(doc.id))!.doc).toEqual(current);
  });

  it('C15 / A11: untrusted proposals cannot mark a fare live or a booking confirmed', () => {
    const doc = demoTrip();
    const before = JSON.stringify(doc.bookingMarks);
    const p = preview(
      doc,
      [
        { type: 'AddClaim', claim: { id: 'fake_live', subjectId: 'leg_outbound', kind: 'price', evidenceStatus: 'live_quote', sourceUrl: null, checkedAt: null, dataKind: 'synthetic' } },
        { type: 'RecordBooking', mark: { id: 'fake_booking', subjectId: 'leg_outbound', status: 'booked', recordedAt: '2030-01-01T00:00:00Z', recordedBy: 'user' } },
      ],
      'untrusted_proposal',
    );
    expect(p.status).toBe('rejected');
    expect(p.messages.join(' ')).toMatch(/only you/i);
    expect(JSON.stringify(doc.bookingMarks)).toBe(before);
    const planner = preview(doc, [{ type: 'AddBudgetItem', item: { id: 'x', subjectId: null, label: 'x', currency: 'GBP', minorUnitDigits: 2, unitAmountMinor: 1, priceBasis: 'per_booking', quantity: {}, status: 'booked_cost' } }], 'planner');
    expect(planner.status).toBe('rejected');
    const userQuote = preview(doc, [{ type: 'AddClaim', claim: { id: 'real_quote', subjectId: 'leg_outbound', kind: 'price', evidenceStatus: 'user_recorded', sourceUrl: 'https://example.org/quote', checkedAt: '2030-01-01', dataKind: 'user' } }]);
    expect(userQuote.status).toBe('ready');
  });

  it('rejects malformed proposals at the validation boundary', () => {
    const doc = demoTrip();
    expect(previewProposal(doc, { id: 'x', baseRevision: 1, actor: 'untrusted_proposal', label: 'x', commands: [{ type: 'DropDatabase' }] }).status).toBe('invalid');
    expect(previewProposal(doc, { id: 'x', baseRevision: 1, actor: 'root', label: 'x', commands: [] }).status).toBe('invalid');
  });

  it('A07: an incomplete draft saves and reopens without becoming green, confirmed or zero-cost', async () => {
    const repo = new MemoryTripRepository();
    const doc = await repo.create(demoTrip());
    const p = makeProposal(doc, 'remove time', [
      { type: 'UpdateTravelLeg', legId: 'leg_market_harbour', patch: { departure: null, arrival: null } },
      { type: 'AddBudgetItem', item: { id: 'unknown_hotel', subjectId: 'stay_market', label: 'Hotel, price unknown', currency: 'GBP', minorUnitDigits: 2, unitAmountMinor: null, priceBasis: 'per_room_night', quantity: { rooms: 1, nights: 3 }, status: 'unknown' } },
    ]);
    const r = previewProposal(doc, p);
    expect(r.canApply).toBe(true);
    await repo.commit(doc.id, p.baseRevision, r.next!, 'draft');
    const reopened = (await repo.get(doc.id))!.doc;
    const results = evaluateConstraints(reopened);
    expect(results.find((x) => x.id === 'leg:leg_market_harbour')?.status).toBe('unresolved');
    const budget = budgetSummaryFor(reopened);
    expect(budget.complete).toBe(false);
    expect(budget.grandTotal).toBeNull();
    expect(budget.byCurrency[0]!.knownMinMinor).toBe(53000);
    expect(reopened.travelLegs.find((l) => l.id === 'leg_outbound')?.departure).not.toBeNull();
  });

  it('C19 / A10: undo and redo are new commits; a new edit clears redo; old proposals stay stale', async () => {
    const repo = new MemoryTripRepository();
    let doc = await repo.create(demoTrip());
    for (const title of ['Fictional A', 'Fictional B']) {
      const p = makeProposal(doc, title, [{ type: 'SetTripDetails', title }]);
      doc = (await repo.commit(doc.id, p.baseRevision, previewProposal(doc, p).next!, title)).doc;
    }
    expect(doc.revision).toBe(3);
    const oldProposal = makeProposal(doc, 'old', [{ type: 'SetTripDetails', title: 'Fictional C' }]);
    const undone = await repo.undo(doc.id, 3);
    expect(undone.doc.revision).toBe(4);
    expect(undone.doc.title).toBe('Fictional A');
    expect(previewProposal(undone.doc, oldProposal).status).toBe('stale');
    const redone = await repo.redo(doc.id, 4);
    expect(redone.doc.revision).toBe(5);
    expect(redone.doc.title).toBe('Fictional B');
    const undone2 = await repo.undo(doc.id, 5);
    expect(undone2.history.canRedo).toBe(true);
    const p = makeProposal(undone2.doc, 'branch', [{ type: 'SetTripDetails', title: 'Fictional D' }]);
    const branched = await repo.commit(doc.id, p.baseRevision, previewProposal(undone2.doc, p).next!, 'branch');
    expect(branched.doc.revision).toBe(7);
    expect(branched.history.canRedo).toBe(false);
  });

  it('A05: locked stays survive edits; changing them needs an explicit unlock', () => {
    const doc = demoTrip();
    doc.stays.find((s) => s.id === 'stay_market')!.lockedFields = ['checkIn', 'checkOutExclusive'];
    const blocked = preview(doc, [{ type: 'ResizeStay', stayId: 'stay_market', nights: 4 }]);
    expect(blocked.status).toBe('rejected');
    const shifting = preview(doc, [{ type: 'ResizeStay', stayId: 'stay_lantern', nights: 5, shiftFollowing: true }]);
    expect(shifting.status).toBe('rejected');
    const unlocked = preview(doc, [
      { type: 'UnlockField', subjectId: 'stay_market', field: 'dates' },
      { type: 'ResizeStay', stayId: 'stay_market', nights: 2 },
    ]);
    expect(unlocked.next?.stays.find((s) => s.id === 'stay_market')?.checkOutExclusive).toBe('2030-06-17');
  });

  it('shifting following stays keeps the night count and moves dependent travel', () => {
    const doc = demoTrip();
    const p = preview(doc, [{ type: 'ResizeStay', stayId: 'stay_market', nights: 4, shiftFollowing: true }]);
    const next = p.next!;
    expect(next.stays.find((s) => s.id === 'stay_harbour')?.checkIn).toBe('2030-06-19');
    expect(next.travelLegs.find((l) => l.id === 'leg_market_harbour')?.departure?.localDateTime).toBe('2030-06-19T11:00');
    expect(next.travelLegs.find((l) => l.id === 'leg_return')?.arrival?.localDateTime).toBe('2030-07-02T21:00');
    expect(result(p, 'anchor_home')?.status).toBe('violated');
    expect(p.canApply).toBe(false);
    expect(next.claims.find((c) => c.id === 'claim_market_harbour') && claimApplicability(next, next.claims.find((c) => c.id === 'claim_market_harbour')!).applicable).toBe(false);
  });
});
