import { z } from 'zod';
import { checkIntegrity } from '../domain/integrity';
import { nightsBetween } from '../domain/dates';
import { sortStays } from '../domain/derive';
import { LIMITS, SCHEMA_VERSION, safeUrl, tripDocument, type TripDocument } from '../domain/schema';
import type { HistoryState } from './history';

export const BACKUP_FORMAT = 'holiday-planner/trip';
export const SHARE_FORMAT = 'holiday-planner/shareable';

export function exportBackup(doc: TripDocument, history: HistoryState | null, now = new Date().toISOString()): string {
  return JSON.stringify({ format: BACKUP_FORMAT, formatVersion: 1, kind: 'private_backup', exportedAt: now, document: doc, history }, null, 2);
}

export type ImportResult = { ok: true; doc: TripDocument; warnings: string[] } | { ok: false; errors: string[] };

/**
 * Validates everything before anything is written: size, JSON syntax,
 * format, schema version, field shapes, array bounds, dates, link schemes
 * and references. A failed import changes nothing.
 */
export function parseImport(text: string, existingIds: Set<string>): ImportResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > LIMITS.importBytes) {
    return { ok: false, errors: [`The file is ${(bytes / 1e6).toFixed(1)} MB. The limit is ${(LIMITS.importBytes / 1e6).toFixed(0)} MB.`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['This is not valid JSON.'] };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Expected a trip file.'] };
  const obj = raw as Record<string, unknown>;
  if (obj.format === SHARE_FORMAT) {
    return { ok: false, errors: ['This is a shareable copy. It leaves out details on purpose and cannot be restored as a trip. Import a private backup instead.'] };
  }
  const candidate = obj.format === BACKUP_FORMAT ? obj.document : 'schemaVersion' in obj ? obj : undefined;
  if (!candidate || typeof candidate !== 'object') return { ok: false, errors: ['This file is not a Holiday Planner trip.'] };
  const version = (candidate as Record<string, unknown>).schemaVersion;
  if (version !== SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        typeof version === 'number' && version > SCHEMA_VERSION
          ? `This trip was made by a newer version (schema ${version}). This app reads schema ${SCHEMA_VERSION}.`
          : `Unsupported schema version: ${String(version)}.`,
      ],
    };
  }
  const parsed = tripDocument.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || 'document'}: ${i.message}`) };
  }
  const problems = checkIntegrity(parsed.data);
  if (problems.length) return { ok: false, errors: problems.slice(0, 10) };
  const warnings: string[] = [];
  let doc = parsed.data;
  if (existingIds.has(doc.id)) {
    let n = 2;
    while (existingIds.has(`${doc.id}-${n}`)) n++;
    doc = { ...doc, id: `${doc.id}-${n}`.slice(0, 120) };
    warnings.push('A trip with the same id already exists, so this one was imported as a copy.');
  }
  return { ok: true, doc, warnings };
}

export interface ShareOptions {
  omitExactDates: boolean;
  omitAccommodation: boolean;
  omitCosts: boolean;
}

const sharedTime = z.union([
  z.object({ localDateTime: z.string(), timeZone: z.string() }).strict(),
  z.object({ day: z.number().int(), time: z.string(), timeZone: z.string() }).strict(),
]);

/** Allowlisted share format: anything not named here cannot leave the device in a shareable copy. */
export const shareableTrip = z
  .object({
    format: z.literal(SHARE_FORMAT),
    formatVersion: z.literal(1),
    notice: z.string(),
    fictional: z.boolean(),
    title: z.string(),
    dates: z.enum(['exact', 'relative']),
    travellerCount: z.number().int(),
    preferences: z.object({ pace: z.string(), weights: z.record(z.string(), z.number()) }).strict(),
    places: z.array(z.object({ key: z.string(), name: z.string(), timeZone: z.string(), tags: z.array(z.string()) }).strict()),
    stays: z.array(
      z
        .object({
          place: z.string(),
          checkIn: z.string().optional(),
          checkOutExclusive: z.string().optional(),
          startDay: z.number().int().optional(),
          nights: z.number().int(),
          why: z.string().optional(),
          accommodation: z.string().optional(),
        })
        .strict(),
    ),
    travel: z.array(
      z
        .object({
          from: z.string(),
          to: z.string(),
          mode: z.string(),
          departure: sharedTime.optional(),
          arrival: sharedTime.optional(),
          durationRangeMinutes: z.object({ min: z.number(), max: z.number() }).strict().optional(),
          timing: z.string(),
        })
        .strict(),
    ),
    activities: z.array(
      z.object({ place: z.string(), title: z.string(), date: z.string().optional(), day: z.number().int().optional(), partOfDay: z.string().optional() }).strict(),
    ),
    commitments: z.array(z.object({ kind: z.string(), label: z.string() }).strict()),
    evidence: z.array(z.object({ about: z.string(), status: z.string(), sourceUrl: safeUrl.nullable(), checkedAt: z.string().nullable() }).strict()),
    budget: z
      .array(
        z
          .object({
            label: z.string(),
            currency: z.string(),
            minorUnitDigits: z.number().int(),
            unitAmountMinor: z.number().int().nullable(),
            unitAmountMaxMinor: z.number().int().nullable(),
            priceBasis: z.string(),
            quantity: z.record(z.string(), z.number()),
            status: z.string(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type ShareableTrip = z.infer<typeof shareableTrip>;

export function buildShareable(doc: TripDocument, options: ShareOptions): ShareableTrip {
  const keys = new Map(doc.places.map((p, i) => [p.id, `place${i + 1}`]));
  const key = (id: string) => keys.get(id) ?? 'unknown';
  const origin = doc.window?.firstNight ?? doc.departureDate;
  const dayOf = (date: string) => nightsBetween(origin, date) + 1;
  const time = (t: { localDateTime: string; timeZone: string } | null | undefined) => {
    if (!t) return undefined;
    if (!options.omitExactDates) return { localDateTime: t.localDateTime, timeZone: t.timeZone };
    return { day: dayOf(t.localDateTime.slice(0, 10)), time: t.localDateTime.slice(11, 16), timeZone: t.timeZone };
  };
  const nameOf = (id: string) => doc.places.find((p) => p.id === id)?.name ?? 'a place';
  const subjectLabel = (id: string) => {
    const s = doc.stays.find((x) => x.id === id);
    if (s) return `Stay in ${nameOf(s.placeId)}`;
    const l = doc.travelLegs.find((x) => x.id === id);
    if (l) return `${nameOf(l.fromPlaceId)} → ${nameOf(l.toPlaceId)}`;
    const a = doc.activities.find((x) => x.id === id);
    if (a) return a.title;
    const p = doc.places.find((x) => x.id === id);
    if (p) return p.name;
    return 'Removed item';
  };
  const share: ShareableTrip = {
    format: SHARE_FORMAT,
    formatVersion: 1,
    notice: `Shareable copy of a ${doc.isSynthetic ? 'fictional demo ' : ''}trip plan. It is a plan, not a booking. Traveller details, booking references, private notes and edit history are not included.`,
    fictional: doc.isSynthetic,
    title: doc.title,
    dates: options.omitExactDates ? 'relative' : 'exact',
    travellerCount: doc.travellers.count,
    preferences: { pace: doc.profile.pace, weights: { ...doc.profile.weights } },
    places: doc.places.map((p) => ({ key: key(p.id), name: p.id === doc.homePlaceId ? 'Home' : p.name, timeZone: p.timeZone, tags: [...p.tags] })),
    stays: sortStays(doc.stays).map((s) => {
      const out: ShareableTrip['stays'][number] = { place: key(s.placeId), nights: nightsBetween(s.checkIn, s.checkOutExclusive) };
      if (options.omitExactDates) out.startDay = dayOf(s.checkIn);
      else {
        out.checkIn = s.checkIn;
        out.checkOutExclusive = s.checkOutExclusive;
      }
      if (s.reason) out.why = s.reason;
      if (!options.omitAccommodation && s.accommodation?.name) out.accommodation = s.accommodation.name;
      return out;
    }),
    travel: doc.travelLegs.map((l) => {
      const out: ShareableTrip['travel'][number] = { from: key(l.fromPlaceId), to: key(l.toPlaceId), mode: l.mode, timing: l.timingStatus };
      const dep = time(l.departure);
      const arr = time(l.arrival);
      if (dep) out.departure = dep;
      if (arr) out.arrival = arr;
      if (l.durationRangeMinutes) out.durationRangeMinutes = { min: l.durationRangeMinutes.min, max: l.durationRangeMinutes.max };
      return out;
    }),
    activities: doc.activities.map((a) => {
      const date = a.start ? a.start.localDateTime.slice(0, 10) : (a.date ?? undefined);
      const out: ShareableTrip['activities'][number] = { place: key(a.placeId), title: a.title };
      if (date) {
        if (options.omitExactDates) out.day = dayOf(date);
        else out.date = date;
      }
      if (a.partOfDay) out.partOfDay = a.partOfDay;
      return out;
    }),
    commitments: doc.anchors.map((a) => ({ kind: a.kind, label: a.label ?? a.kind.replaceAll('_', ' ') })),
    evidence: doc.claims.map((c) => ({ about: subjectLabel(c.subjectId), status: c.evidenceStatus, sourceUrl: c.sourceUrl, checkedAt: c.checkedAt })),
  };
  if (!options.omitCosts) {
    share.budget = doc.budgetItems.map((b) => ({
      label: b.label,
      currency: b.currency,
      minorUnitDigits: b.minorUnitDigits,
      unitAmountMinor: b.unitAmountMinor,
      unitAmountMaxMinor: b.unitAmountMaxMinor ?? null,
      priceBasis: b.priceBasis,
      quantity: Object.fromEntries(Object.entries(b.quantity).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
      status: b.status,
    }));
  }
  return shareableTrip.parse(share);
}

export function exportShareable(doc: TripDocument, options: ShareOptions): string {
  return JSON.stringify(buildShareable(doc, options), null, 2);
}
