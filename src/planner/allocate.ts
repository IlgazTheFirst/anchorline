import { nightsUtility } from './score';

export interface StopSpec {
  placeId: string;
  lo: number;
  hi: number;
  value: number;
  tags: string[];
  /** Night offsets from the first night that this stop must cover. */
  pins: Array<{ first: number; last: number; exact: boolean }>;
}

export interface Allocation {
  nights: number[];
  utility: number;
}

interface Cell {
  value: number;
  prev: string | null;
  nights: number;
}

/**
 * Dynamic programme over (stop, nights used, constraint progress). It finds
 * the night split with the highest diminishing-returns utility that fills
 * every night, keeps each stop within its bounds, covers pinned nights and
 * meets consecutive-night and full-day minimums. Returns null if none exists.
 */
export function allocateNights(
  stops: StopSpec[],
  totalNights: number,
  consecutive: Array<{ tag: string; min: number }>,
  fullDays: Array<{ tag: string; min: number }>,
): Allocation | null {
  const k = stops.length;
  if (k === 0) return null;
  const suffixLo: number[] = new Array(k + 1).fill(0);
  const suffixHi: number[] = new Array(k + 1).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    suffixLo[i] = suffixLo[i + 1]! + stops[i]!.lo;
    suffixHi[i] = suffixHi[i + 1]! + stops[i]!.hi;
  }
  if (suffixLo[0]! > totalNights || suffixHi[0]! < totalNights) return null;

  const encode = (u: number, runs: number[], bests: number[], fulls: number[]) => `${u}|${runs.join(',')}|${bests.join(',')}|${fulls.join(',')}`;
  const decode = (key: string) => {
    const [u, r, b, f] = key.split('|');
    const nums = (s: string | undefined) => (s ? s.split(',').map(Number) : []);
    return { u: Number(u), runs: nums(r), bests: nums(b), fulls: nums(f) };
  };
  const layers: Array<Map<string, Cell>> = [];
  let current = new Map<string, Cell>([[encode(0, consecutive.map(() => 0), consecutive.map(() => 0), fullDays.map(() => 0)), { value: 0, prev: null, nights: 0 }]]);
  layers.push(current);
  for (let i = 0; i < k; i++) {
    const stop = stops[i]!;
    const next = new Map<string, Cell>();
    for (const [key, cell] of current) {
      const { u, runs, bests, fulls } = decode(key);
      for (let n = stop.lo; n <= stop.hi; n++) {
        const used = u + n;
        const remaining = totalNights - used;
        if (remaining < suffixLo[i + 1]! || remaining > suffixHi[i + 1]!) continue;
        const pinOk = stop.pins.every((p) => (p.exact ? u === p.first && used - 1 === p.last : u <= p.first && used - 1 >= p.last));
        if (!pinOk) continue;
        const nr = consecutive.map((c, j) => (stop.tags.includes(c.tag) ? Math.min(c.min, runs[j]! + n) : 0));
        const nb = consecutive.map((_, j) => Math.max(bests[j]!, nr[j]!));
        const nf = fullDays.map((f, j) => (stop.tags.includes(f.tag) ? Math.min(f.min, fulls[j]! + Math.max(0, n - 1)) : fulls[j]!));
        const nk = encode(used, nr, nb, nf);
        const value = cell.value + nightsUtility(stop.value, n);
        const existing = next.get(nk);
        if (!existing || value > existing.value + 1e-12) next.set(nk, { value, prev: key, nights: n });
      }
    }
    layers.push(next);
    current = next;
  }
  let bestKey: string | null = null;
  let bestValue = -Infinity;
  for (const [key, cell] of current) {
    const { u, bests, fulls } = decode(key);
    if (u !== totalNights) continue;
    if (!consecutive.every((c, j) => bests[j]! >= c.min)) continue;
    if (!fullDays.every((f, j) => fulls[j]! >= f.min)) continue;
    if (cell.value > bestValue + 1e-12) {
      bestValue = cell.value;
      bestKey = key;
    }
  }
  if (bestKey === null) return null;
  const nights: number[] = [];
  let key: string | null = bestKey;
  for (let i = k; i > 0 && key; i--) {
    const cell: Cell = layers[i]!.get(key)!;
    nights.unshift(cell.nights);
    key = cell.prev;
  }
  return { nights, utility: bestValue };
}
