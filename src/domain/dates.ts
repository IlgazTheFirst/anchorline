import { Temporal } from 'temporal-polyfill';

export { Temporal };

/** A wall-clock time in a named IANA zone. `offset` resolves DST ambiguity explicitly. */
export interface ZonedTime {
  localDateTime: string;
  timeZone: string;
  offset?: string | null;
}

export type ResolvedInstant =
  | { status: 'ok'; instant: Temporal.Instant; zoned: Temporal.ZonedDateTime }
  | { status: 'ambiguous'; candidates: string[]; message: string }
  | { status: 'nonexistent'; message: string }
  | { status: 'invalid'; message: string };

export function isValidPlainDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

export function isValidLocalDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return false;
  try {
    Temporal.PlainDateTime.from(value, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

const zoneCache = new Map<string, boolean>();
export function isValidTimeZone(zone: string): boolean {
  const cached = zoneCache.get(zone);
  if (cached !== undefined) return cached;
  let ok: boolean;
  try {
    Temporal.Now.instant().toZonedDateTimeISO(zone);
    ok = zone.length > 0;
  } catch {
    ok = false;
  }
  zoneCache.set(zone, ok);
  return ok;
}

/**
 * Resolves a wall-clock time to an instant. Never guesses: a time that occurs
 * twice (autumn change) or never (spring change) needs an explicit offset.
 */
export function resolveZoned(time: ZonedTime): ResolvedInstant {
  if (!isValidLocalDateTime(time.localDateTime)) {
    return { status: 'invalid', message: `"${time.localDateTime}" is not a valid local date and time.` };
  }
  if (!isValidTimeZone(time.timeZone)) {
    return { status: 'invalid', message: `"${time.timeZone}" is not a known time zone.` };
  }
  const pdt = Temporal.PlainDateTime.from(time.localDateTime);
  if (time.offset) {
    try {
      const zoned = Temporal.ZonedDateTime.from(`${pdt.toString()}${time.offset}[${time.timeZone}]`, { offset: 'reject' });
      return { status: 'ok', instant: zoned.toInstant(), zoned };
    } catch {
      return { status: 'invalid', message: `Offset ${time.offset} does not occur at ${time.localDateTime} in ${time.timeZone}.` };
    }
  }
  try {
    const zoned = pdt.toZonedDateTime(time.timeZone, { disambiguation: 'reject' });
    return { status: 'ok', instant: zoned.toInstant(), zoned };
  } catch {
    const earlier = pdt.toZonedDateTime(time.timeZone, { disambiguation: 'earlier' });
    const later = pdt.toZonedDateTime(time.timeZone, { disambiguation: 'later' });
    if (Temporal.PlainDateTime.compare(earlier.toPlainDateTime(), pdt) === 0 && !earlier.equals(later)) {
      return {
        status: 'ambiguous',
        candidates: [earlier.offset, later.offset],
        message: `${formatLocal(time.localDateTime)} happens twice in ${time.timeZone} (clocks go back). Choose offset ${earlier.offset} or ${later.offset}.`,
      };
    }
    return {
      status: 'nonexistent',
      message: `${formatLocal(time.localDateTime)} does not exist in ${time.timeZone} (clocks go forward). Pick a time outside the skipped hour.`,
    };
  }
}

export function instantOf(time: ZonedTime | null | undefined): Temporal.Instant | null {
  if (!time) return null;
  const r = resolveZoned(time);
  return r.status === 'ok' ? r.instant : null;
}

export function elapsedMinutes(from: ZonedTime, to: ZonedTime): number | null {
  const a = instantOf(from);
  const b = instantOf(to);
  if (!a || !b) return null;
  return Math.round(a.until(b, { largestUnit: 'minutes' }).total({ unit: 'minutes' }));
}

/** Hotel nights are calendar-date differences, never UTC milliseconds / 24h. */
export function nightsBetween(checkIn: string, checkOutExclusive: string): number {
  return Temporal.PlainDate.from(checkIn).until(Temporal.PlainDate.from(checkOutExclusive), { largestUnit: 'days' }).days;
}

/** Elapsed hours between two local midnights, which DST can make 23 or 25. */
export function hoursBetweenLocalMidnights(date: string, nextDate: string, timeZone: string): number {
  const a = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone });
  const b = Temporal.PlainDate.from(nextDate).toZonedDateTime({ timeZone });
  return a.until(b, { largestUnit: 'hours' }).total({ unit: 'hours' });
}

export function addDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function compareDates(a: string, b: string): number {
  return Temporal.PlainDate.compare(Temporal.PlainDate.from(a), Temporal.PlainDate.from(b));
}

export function datesInRange(startInclusive: string, endExclusive: string): string[] {
  const out: string[] = [];
  let d = Temporal.PlainDate.from(startInclusive);
  const end = Temporal.PlainDate.from(endExclusive);
  while (Temporal.PlainDate.compare(d, end) < 0) {
    out.push(d.toString());
    d = d.add({ days: 1 });
  }
  return out;
}

export function localDateOf(time: ZonedTime): string {
  return time.localDateTime.slice(0, 10);
}

/** The local date of an instant as seen in another zone. */
export function dateInZone(instant: Temporal.Instant, timeZone: string): string {
  return instant.toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function addMinutes(instant: Temporal.Instant, minutes: number): Temporal.Instant {
  return instant.add({ minutes });
}

export function toZoned(instant: Temporal.Instant, timeZone: string): ZonedTime {
  const z = instant.toZonedDateTimeISO(timeZone);
  return { localDateTime: z.toPlainDateTime().toString({ smallestUnit: 'minute' }), timeZone, offset: z.offset };
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayOfWeek(date: string): number {
  return Temporal.PlainDate.from(date).dayOfWeek;
}

export function monthOf(date: string): number {
  return Temporal.PlainDate.from(date).month;
}

export function formatDate(date: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = Temporal.PlainDate.from(date);
  const parts = [`${d.day} ${MONTHS[d.month - 1]}`];
  if (opts.year) parts.push(String(d.year));
  const core = parts.join(' ');
  return opts.weekday === false ? core : `${WEEKDAYS[d.dayOfWeek - 1]} ${core}`;
}

export function formatLocal(localDateTime: string): string {
  const pdt = Temporal.PlainDateTime.from(localDateTime);
  const time = `${String(pdt.hour).padStart(2, '0')}:${String(pdt.minute).padStart(2, '0')}`;
  return `${formatDate(pdt.toPlainDate().toString())} ${time}`;
}

export function formatZoned(time: ZonedTime): string {
  return `${formatLocal(time.localDateTime)} (${time.timeZone})`;
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
