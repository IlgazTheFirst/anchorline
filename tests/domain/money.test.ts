import { describe, expect, it } from 'vitest';
import { lineTotal, parseMinor, perPersonShare, summariseBudget } from '../../src/domain/money';
import type { BudgetItem } from '../../src/domain/schema';

const item = (over: Partial<BudgetItem>): BudgetItem => ({
  id: over.id ?? 'b',
  subjectId: null,
  label: 'x',
  currency: 'GBP',
  minorUnitDigits: 2,
  unitAmountMinor: 1000,
  unitAmountMaxMinor: null,
  priceBasis: 'per_booking',
  quantity: {},
  status: 'user_allowance',
  ...over,
});

describe('money', () => {
  it('C11: unknown prices stay unknown and block a grand total', () => {
    const s = summariseBudget([
      item({ id: 'a', unitAmountMinor: 48000 }),
      item({ id: 'b', unitAmountMinor: 5000 }),
      item({ id: 'c', unitAmountMinor: null, status: 'unknown' }),
    ]);
    expect(s.byCurrency[0]!.knownMinMinor).toBe(53000);
    expect(s.unknownItems).toHaveLength(1);
    expect(s.complete).toBe(false);
    expect(s.grandTotal).toBeNull();
  });

  it('C12: no mixed-currency total without an exchange rate', () => {
    const s = summariseBudget([item({ id: 'a', unitAmountMinor: 10000 }), item({ id: 'b', unitAmountMinor: 10000, currency: 'EUR' })], { baseCurrency: 'GBP' });
    expect(s.byCurrency.map((c) => c.currency)).toEqual(['EUR', 'GBP']);
    expect(s.grandTotal).toBeNull();
    const withFx = summariseBudget([item({ id: 'a', unitAmountMinor: 10000 }), item({ id: 'b', unitAmountMinor: 10000, currency: 'EUR' })], {
      baseCurrency: 'GBP',
      fx: [{ from: 'EUR', to: 'GBP', rate: 0.85, asOf: '2030-01-01', source: 'user_entered' }],
    });
    expect(withFx.grandTotal).toMatchObject({ currency: 'GBP', minMinor: 18500, usedFx: true });
  });

  it('C13: a room price is not multiplied by every traveller', () => {
    const room = item({ unitAmountMinor: 12000, priceBasis: 'per_room_night', quantity: { rooms: 1, nights: 4, people: 2 } });
    expect(lineTotal(room)).toEqual({ minMinor: 48000, maxMinor: 48000 });
    expect(perPersonShare(48000, 2)).toEqual({ shareMinor: 24000, remainderMinor: 0 });
  });

  it('A12: per-person and per-booking multiply once; ranges survive', () => {
    expect(lineTotal(item({ unitAmountMinor: 2500, priceBasis: 'per_person', quantity: { people: 3 } }))).toEqual({ minMinor: 7500, maxMinor: 7500 });
    expect(lineTotal(item({ unitAmountMinor: 9000, priceBasis: 'per_booking', quantity: { bookings: 1, people: 4 } }))).toEqual({ minMinor: 9000, maxMinor: 9000 });
    expect(lineTotal(item({ unitAmountMinor: 3000, unitAmountMaxMinor: 4500, priceBasis: 'per_person_night', quantity: { people: 2, nights: 3 } }))).toEqual({ minMinor: 18000, maxMinor: 27000 });
    expect(lineTotal(item({ priceBasis: 'per_room_night', quantity: { rooms: 1 } }))).toBeNull();
    expect(perPersonShare(10001, 2)).toEqual({ shareMinor: 5000, remainderMinor: 1 });
  });

  it('parses typed amounts into integer minor units', () => {
    expect(parseMinor('120.5', 2)).toBe(12050);
    expect(parseMinor('1,200', 0)).toBe(1200);
    expect(parseMinor('12.345', 2)).toBeNull();
    expect(parseMinor('abc', 2)).toBeNull();
  });
});
