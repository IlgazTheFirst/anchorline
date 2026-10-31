import type { BudgetItem, TripDocument } from './schema';

/** Amounts are integer minor units. A null amount means unknown, never zero. */
export interface AmountRange {
  minMinor: number;
  maxMinor: number;
}

export interface CurrencyTotal {
  currency: string;
  minorUnitDigits: number;
  knownMinMinor: number;
  knownMaxMinor: number;
  itemCount: number;
}

export interface BudgetSummary {
  byCurrency: CurrencyTotal[];
  unknownItems: BudgetItem[];
  inapplicableItems: BudgetItem[];
  complete: boolean;
  /** Only when every item is known and either one currency or explicit FX covers them all. */
  grandTotal: (AmountRange & { currency: string; usedFx: boolean }) | null;
  notes: string[];
}

export interface FxAssumption {
  from: string;
  to: string;
  rate: number;
  asOf: string;
  source: 'user_entered';
}

export function multiplierFor(item: BudgetItem): { factor: number; missing: string | null } {
  const q = item.quantity;
  const need = (value: number | undefined, label: string) => (value === undefined ? label : null);
  switch (item.priceBasis) {
    case 'per_room_night':
      return { factor: (q.rooms ?? 0) * (q.nights ?? 0), missing: need(q.rooms, 'rooms') ?? need(q.nights, 'nights') };
    case 'per_person':
      return { factor: q.people ?? 0, missing: need(q.people, 'people') };
    case 'per_person_night':
      return { factor: (q.people ?? 0) * (q.nights ?? 0), missing: need(q.people, 'people') ?? need(q.nights, 'nights') };
    case 'per_room':
      return { factor: q.rooms ?? 0, missing: need(q.rooms, 'rooms') };
    case 'per_journey':
      return { factor: q.journeys ?? 1, missing: null };
    case 'per_booking':
      return { factor: q.bookings ?? 1, missing: null };
  }
}

/** Applies the price basis exactly once. Returns null when the price is unknown. */
export function lineTotal(item: BudgetItem): AmountRange | null {
  if (item.unitAmountMinor === null || item.status === 'unknown') return null;
  const { factor, missing } = multiplierFor(item);
  if (missing) return null;
  const max = item.unitAmountMaxMinor ?? item.unitAmountMinor;
  return { minMinor: item.unitAmountMinor * factor, maxMinor: Math.max(max, item.unitAmountMinor) * factor };
}

export function summariseBudget(
  items: BudgetItem[],
  options: { baseCurrency?: string; fx?: FxAssumption[]; isApplicable?: (item: BudgetItem) => boolean } = {},
): BudgetSummary {
  const byCurrency = new Map<string, CurrencyTotal>();
  const unknownItems: BudgetItem[] = [];
  const inapplicableItems: BudgetItem[] = [];
  const notes: string[] = [];
  for (const item of items) {
    if (options.isApplicable && !options.isApplicable(item)) {
      inapplicableItems.push(item);
      continue;
    }
    const total = lineTotal(item);
    if (!total) {
      unknownItems.push(item);
      continue;
    }
    const entry = byCurrency.get(item.currency) ?? {
      currency: item.currency,
      minorUnitDigits: item.minorUnitDigits,
      knownMinMinor: 0,
      knownMaxMinor: 0,
      itemCount: 0,
    };
    entry.knownMinMinor += total.minMinor;
    entry.knownMaxMinor += total.maxMinor;
    entry.itemCount += 1;
    byCurrency.set(item.currency, entry);
  }
  const currencies = [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  const complete = unknownItems.length === 0 && inapplicableItems.length === 0;
  let grandTotal: BudgetSummary['grandTotal'] = null;
  if (complete && currencies.length > 0) {
    const target = options.baseCurrency ?? currencies[0]!.currency;
    let min = 0;
    let max = 0;
    let usedFx = false;
    let convertible = true;
    for (const c of currencies) {
      if (c.currency === target) {
        min += c.knownMinMinor;
        max += c.knownMaxMinor;
        continue;
      }
      const rate = options.fx?.find((f) => f.from === c.currency && f.to === target);
      if (!rate) {
        convertible = false;
        break;
      }
      usedFx = true;
      min += Math.round(c.knownMinMinor * rate.rate);
      max += Math.round(c.knownMaxMinor * rate.rate);
      notes.push(`${c.currency}→${target} at ${rate.rate} (your rate, as of ${rate.asOf}).`);
    }
    if (convertible) grandTotal = { currency: target, minMinor: min, maxMinor: max, usedFx };
    else notes.push('Amounts in different currencies are shown separately. Add an exchange rate to combine them.');
  }
  if (unknownItems.length) notes.push(`${unknownItems.length} item(s) have no price yet, so there is no trip total.`);
  if (inapplicableItems.length) notes.push(`${inapplicableItems.length} price(s) belong to an earlier version of the route and are not counted.`);
  return { byCurrency: currencies, unknownItems, inapplicableItems, complete, grandTotal, notes };
}

/** Even split with the remainder reported, never silently lost. */
export function perPersonShare(totalMinor: number, people: number): { shareMinor: number; remainderMinor: number } {
  if (people <= 0) return { shareMinor: totalMinor, remainderMinor: 0 };
  return { shareMinor: Math.floor(totalMinor / people), remainderMinor: totalMinor % people };
}

export function formatMoney(minor: number, currency: string, digits = 2): string {
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

export function formatRange(range: AmountRange, currency: string, digits = 2): string {
  return range.minMinor === range.maxMinor
    ? formatMoney(range.minMinor, currency, digits)
    : `${formatMoney(range.minMinor, currency, digits)}–${formatMoney(range.maxMinor, currency, digits)}`;
}

/** Parses a user-typed amount like "120.50" into minor units without float drift. */
export function parseMinor(input: string, digits: number): number | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > digits) return null;
  return Number(whole) * 10 ** digits + Number(frac.padEnd(digits, '0') || '0');
}

export function budgetSummaryFor(doc: TripDocument, isApplicable?: (item: BudgetItem) => boolean): BudgetSummary {
  return summariseBudget(doc.budgetItems, { baseCurrency: doc.budget.baseCurrency, fx: doc.budget.fx, isApplicable });
}
