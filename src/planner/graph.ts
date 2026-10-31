import type { DestinationPack, RouteOption } from '../catalogue/schema';

export interface Transfer {
  from: string;
  to: string;
  hops: RouteOption[];
  via: string[];
  minMinutes: number;
  maxMinutes: number;
  /** Planning midpoint including a connection allowance per extra hop. */
  typicalMinutes: number;
}

const CONNECTION_MINUTES = 120;

/**
 * All-pairs best transfers over the pack's documented connections
 * (Floyd–Warshall on typical minutes; ties broken by fewer hops, then ids).
 * Every route is a planning assumption, never a timetable.
 */
export class RouteGraph {
  private best = new Map<string, Transfer>();

  constructor(pack: DestinationPack) {
    const ids = pack.places.map((p) => p.id).sort();
    const key = (a: string, b: string) => `${a}>${b}`;
    for (const r of [...pack.routes].sort((x, y) => x.id.localeCompare(y.id))) {
      for (const [from, to] of [
        [r.from, r.to],
        [r.to, r.from],
      ] as const) {
        const t: Transfer = {
          from,
          to,
          hops: [r],
          via: [],
          minMinutes: r.durationMinutes.min,
          maxMinutes: r.durationMinutes.max,
          typicalMinutes: (r.durationMinutes.min + r.durationMinutes.max) / 2,
        };
        const existing = this.best.get(key(from, to));
        if (!existing || t.typicalMinutes < existing.typicalMinutes) this.best.set(key(from, to), t);
      }
    }
    for (const k of ids) {
      for (const i of ids) {
        if (i === k) continue;
        const ik = this.best.get(key(i, k));
        if (!ik) continue;
        for (const j of ids) {
          if (j === i || j === k) continue;
          const kj = this.best.get(key(k, j));
          if (!kj) continue;
          const typical = ik.typicalMinutes + kj.typicalMinutes + CONNECTION_MINUTES;
          const current = this.best.get(key(i, j));
          const hops = ik.hops.length + kj.hops.length;
          if (!current || typical < current.typicalMinutes - 1e-9 || (Math.abs(typical - current.typicalMinutes) < 1e-9 && hops < current.hops.length)) {
            this.best.set(key(i, j), {
              from: i,
              to: j,
              hops: [...ik.hops, ...kj.hops],
              via: [...ik.via, k, ...kj.via],
              minMinutes: ik.minMinutes + kj.minMinutes + CONNECTION_MINUTES,
              maxMinutes: ik.maxMinutes + kj.maxMinutes + CONNECTION_MINUTES,
              typicalMinutes: typical,
            });
          }
        }
      }
    }
  }

  get(from: string, to: string): Transfer | null {
    return this.best.get(`${from}>${to}`) ?? null;
  }
}
