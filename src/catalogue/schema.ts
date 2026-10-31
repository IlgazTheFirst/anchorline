import { z } from 'zod';
import { isValidPlainDate, isValidTimeZone } from '../domain/dates';
import { isSafeHttpUrl } from '../domain/schema';

const id = z.string().regex(/^[a-z0-9_-]+$/).max(80);
const url = z.string().refine(isSafeHttpUrl, 'Only http(s) source links are allowed');
const date = z.string().refine(isValidPlainDate, 'Expected YYYY-MM-DD');
const score = z.number().int().min(0).max(3);
const interestTag = z.enum(['food', 'nightlife', 'beach', 'culture', 'nature', 'adventure', 'city', 'relax']);

export const cataloguePlace = z
  .object({
    id,
    name: z.string().min(1).max(120),
    country: z.string().min(1).max(80),
    timeZone: z.string().refine(isValidTimeZone, 'Unknown IANA time zone'),
    tags: z.array(z.string().min(1).max(40)).min(1).max(12),
    scores: z.object({ food: score, nightlife: score, beach: score, culture: score, nature: score, adventure: score, city: score, relax: score }).strict(),
    familyScore: score,
    recommendedNights: z.object({ min: z.number().int().min(1), ideal: z.number().int().min(1), max: z.number().int().min(1) }).strict(),
    gateway: z.enum(['major', 'regional', 'none']),
    airports: z.array(z.string().regex(/^[A-Z]{3}$/)).max(4),
    summary: z.string().min(10).max(400),
    highlights: z.array(z.string().max(120)).max(8),
    seasonGuidance: z.object({ wetterMonths: z.array(z.number().int().min(1).max(12)), cautionMonths: z.array(z.number().int().min(1).max(12)), note: z.string().max(400) }).strict().nullable(),
    sourceUrls: z.array(url).min(1).max(6),
    checkedAt: date,
    dataKind: z.enum(['curated', 'synthetic']),
  })
  .strict()
  .refine((p) => p.recommendedNights.min <= p.recommendedNights.ideal && p.recommendedNights.ideal <= p.recommendedNights.max, 'Recommended nights must satisfy min ≤ ideal ≤ max');

export const catalogueActivity = z
  .object({
    id,
    placeId: id,
    title: z.string().min(1).max(120),
    summary: z.string().min(10).max(400),
    tags: z.array(interestTag).min(1).max(4),
    partOfDay: z.enum(['morning', 'afternoon', 'evening', 'night', 'any']),
    durationHours: z.object({ min: z.number().min(0), max: z.number().min(0) }).strict(),
    intensity: z.enum(['easy', 'moderate', 'strenuous']),
    distinctive: score,
    alcoholCentred: z.boolean(),
    familyFriendly: z.boolean(),
    stepFree: z.enum(['unknown', 'partial', 'not_step_free', 'step_free']),
    daysOfWeek: z.array(z.number().int().min(1).max(7)).nullable(),
    recurrence: z.object({ kind: z.enum(['lunar_monthly', 'seasonal', 'annual']), note: z.string().max(400) }).strict().nullable(),
    schedulingNote: z.string().max(400).nullable(),
    sourceUrls: z.array(url).min(1).max(6),
    checkedAt: date,
    dataKind: z.enum(['curated', 'synthetic']),
  })
  .strict();

export const routeOption = z
  .object({
    id: z.string().max(80),
    from: id,
    to: id,
    mode: z.string().min(1).max(60),
    durationMinutes: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }).strict(),
    note: z.string().max(400),
    sourceUrls: z.array(url).min(1).max(6),
    checkedAt: date,
    evidence: z.literal('planning_assumption'),
  })
  .strict();

export const destinationPack = z
  .object({
    schemaVersion: z.literal(1),
    packId: id,
    version: z.string().min(1).max(40),
    title: z.string().min(1).max(120),
    author: z.string().min(1).max(200),
    license: z.string().min(1).max(200),
    attribution: z.string().min(1).max(1000),
    dataKind: z.enum(['curated', 'synthetic']),
    checkedAt: date,
    coverage: z.object({ description: z.string().max(600), countries: z.array(z.string().max(80)).max(30) }).strict(),
    sourceUrls: z.array(url).max(20),
    defaultBuffers: z.record(z.string(), z.object({ pre: z.number().int().min(0), post: z.number().int().min(0) }).strict()),
    places: z.array(cataloguePlace).min(1).max(200),
    activities: z.array(catalogueActivity).max(2000),
    routes: z.array(routeOption).max(2000),
    events: z.array(z.unknown()).max(0),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const places = new Set(pack.places.map((p) => p.id));
    if (places.size !== pack.places.length) ctx.addIssue({ code: 'custom', message: 'Duplicate place id' });
    const acts = new Set<string>();
    for (const a of pack.activities) {
      if (!places.has(a.placeId)) ctx.addIssue({ code: 'custom', message: `Activity ${a.id} refers to unknown place ${a.placeId}` });
      if (acts.has(a.id)) ctx.addIssue({ code: 'custom', message: `Duplicate activity id ${a.id}` });
      acts.add(a.id);
      if (a.durationHours.min > a.durationHours.max) ctx.addIssue({ code: 'custom', message: `Activity ${a.id} duration runs backwards` });
    }
    for (const r of pack.routes) {
      if (!places.has(r.from) || !places.has(r.to)) ctx.addIssue({ code: 'custom', message: `Route ${r.id} refers to an unknown place` });
      if (r.durationMinutes.min > r.durationMinutes.max) ctx.addIssue({ code: 'custom', message: `Route ${r.id} duration runs backwards` });
    }
  });

export type CataloguePlace = z.infer<typeof cataloguePlace>;
export type CatalogueActivity = z.infer<typeof catalogueActivity>;
export type RouteOption = z.infer<typeof routeOption>;
export type DestinationPack = z.infer<typeof destinationPack>;
