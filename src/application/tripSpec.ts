import { z } from 'zod';
import type { DestinationPack } from '../catalogue/schema';
import { addDays, compareDates, nightsBetween } from '../domain/dates';
import { customPlaceId } from '../domain/places';
import { PRESETS, presetById } from '../domain/presets';
import { localDateTime, plainDate, timeZone, type Activity, type Anchor, type Place, type Stay, type TripDocument } from '../domain/schema';
import { createTrip } from './newTrip';

const interest = z.number().int().min(0).max(3);
const presetIds = PRESETS.map((p) => p.id) as [string, ...string[]];

/**
 * A compact, human- and machine-friendly trip description. The CLI, the MCP
 * server and the skill all accept it; it becomes a normal trip document with
 * hard commitments, never with bookings or quotes.
 */
export const tripSpec = z
  .object({
    title: z.string().min(1).max(200).optional().describe('Trip name'),
    home: z.object({ name: z.string().min(1).max(120), timeZone: timeZone }).strict().describe('Where the trip starts and ends, with its IANA time zone, e.g. {"name":"London","timeZone":"Europe/London"}'),
    departureDate: plainDate.describe('Date you leave home, YYYY-MM-DD'),
    firstNight: plainDate.optional().describe('First night away, YYYY-MM-DD. Defaults to the day after departureDate'),
    nights: z.number().int().min(1).max(90).optional().describe('Nights away. Give this or leaveDate'),
    leaveDate: plainDate.optional().describe('Day you leave the last stop, YYYY-MM-DD. Give this or nights'),
    homeBy: localDateTime.optional().describe('Latest arrival home, local time at home, YYYY-MM-DDTHH:MM. Checked against arrival after the final transfer'),
    travellers: z.number().int().min(1).max(50).optional(),
    rooms: z.number().int().min(1).max(50).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    preset: z.enum(presetIds).optional().describe(`Travel style. One of: ${presetIds.join(', ')}. Default a_bit_of_everything`),
    pace: z.enum(['slow', 'balanced', 'fast']).optional(),
    interests: z
      .object({ food: interest, nightlife: interest, beach: interest, culture: interest, nature: interest, adventure: interest, city: interest, relax: interest })
      .partial()
      .strict()
      .optional()
      .describe('Interest weights 0-3 that override the preset'),
    quietEvenings: z.boolean().optional().describe('No alcohol-focused suggestions'),
    family: z.boolean().optional().describe('Travelling with children'),
    stepFree: z.boolean().optional().describe('Step-free access needed (the pack rarely has verified data; gaps are reported)'),
    mustVisit: z
      .array(z.object({ place: z.string().min(1).max(120), minNights: z.number().int().min(1).max(60).optional() }).strict())
      .max(15)
      .optional()
      .describe('Catalogue places (id or name) that must be in the plan, optionally with minimum nights'),
    avoid: z.array(z.string().min(1).max(120)).max(15).optional().describe('Catalogue places (id or name) to leave out'),
    beachNights: z.number().int().min(1).max(60).optional().describe('Minimum consecutive nights at beach places'),
    beachDays: z.number().int().min(1).max(60).optional().describe('Minimum full beach days (arrival, departure and transfer days do not count)'),
    events: z
      .array(
        z
          .object({
            title: z.string().min(1).max(200),
            place: z.string().min(1).max(120),
            start: localDateTime.describe('Local time at the place'),
            end: localDateTime,
            arriveEarlyMinutes: z.number().int().min(0).max(1440).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional()
      .describe('Fixed events you must attend; the plan keeps you there for the whole interval'),
    arriveVia: z.string().max(120).optional().describe('Catalogue place you fly into'),
    leaveFrom: z.string().max(120).optional().describe('Catalogue place you fly home from'),
    ownPlaces: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            timeZone: timeZone,
            tags: z.array(z.string().min(1).max(40)).max(8).optional(),
            checkIn: plainDate,
            nights: z.number().int().min(1).max(60),
          })
          .strict(),
      )
      .max(10)
      .optional()
      .describe('Places outside the catalogue with fixed stays. The planner keeps them on these dates and adds no routes or activities for them'),
  })
  .strict()
  .refine((s) => s.nights !== undefined || s.leaveDate !== undefined, { message: 'Give either nights or leaveDate.' });

export type TripSpec = z.infer<typeof tripSpec>;

export class SpecError extends Error {}

/** Finds a catalogue place by id or name, case-insensitively. */
export function resolvePlace(pack: DestinationPack, query: string): string {
  const q = query.trim().toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hit =
    pack.places.find((p) => p.id === q) ??
    pack.places.find((p) => p.name.toLowerCase() === q) ??
    pack.places.find((p) => norm(p.name) === norm(q) || norm(p.id) === norm(q)) ??
    pack.places.find((p) => norm(p.name).startsWith(norm(q)) || norm(p.name).includes(norm(q)));
  if (!hit) throw new SpecError(`"${query}" is not in the ${pack.title} catalogue. Known places: ${pack.places.map((p) => p.name).join(', ')}. Use ownPlaces for anywhere else.`);
  return hit.id;
}

function cataloguePlace(pack: DestinationPack, id: string): Place {
  const p = pack.places.find((x) => x.id === id)!;
  return { id: p.id, name: p.name, timeZone: p.timeZone, tags: p.tags, dataKind: 'curated', catalogueId: p.id, country: p.country, coordinates: null };
}

/** Builds a trip document from a spec. Throws SpecError with a readable message. */
export function tripFromSpec(spec: TripSpec, pack: DestinationPack, id = 'trip_cli'): TripDocument {
  const firstNight = spec.firstNight ?? addDays(spec.departureDate, 1);
  const leaveDate = spec.leaveDate ?? addDays(firstNight, spec.nights!);
  if (compareDates(firstNight, spec.departureDate) < 0) throw new SpecError('firstNight cannot be before departureDate.');
  if (nightsBetween(firstNight, leaveDate) < 1) throw new SpecError('leaveDate must be after the first night.');
  const preset = structuredClone(presetById(spec.preset ?? 'a_bit_of_everything').profile);
  if (spec.pace) preset.pace = spec.pace;
  if (spec.interests) preset.weights = { ...preset.weights, ...spec.interests };
  if (spec.quietEvenings !== undefined) preset.alcoholPreference = spec.quietEvenings ? 'avoid_alcohol_focused' : 'unspecified';
  if (spec.family !== undefined) preset.familyFriendly = spec.family;
  if (spec.stepFree !== undefined) preset.accessibility = { ...preset.accessibility, stepFreeNeeded: spec.stepFree };
  const doc = createTrip(
    {
      title: spec.title ?? `Trip from ${spec.home.name}`,
      homeName: spec.home.name,
      homeTimeZone: spec.home.timeZone,
      departureDate: spec.departureDate,
      firstNight,
      leaveDate,
      homeBy: spec.homeBy ? { localDateTime: spec.homeBy, bufferMinutes: 60 } : null,
      travellers: spec.travellers ?? 2,
      rooms: spec.rooms ?? 1,
      currency: spec.currency ?? 'GBP',
      budgetAmountMinor: null,
      budgetBasis: 'whole_group',
      profile: preset,
      arrivalGatewayId: spec.arriveVia ? resolvePlace(pack, spec.arriveVia) : null,
      departureGatewayId: spec.leaveFrom ? resolvePlace(pack, spec.leaveFrom) : null,
    },
    id,
  );
  const places = new Map<string, Place>();
  const anchors: Anchor[] = [];
  const activities: Activity[] = [];
  const stays: Stay[] = [];
  for (const m of spec.mustVisit ?? []) {
    const pid = resolvePlace(pack, m.place);
    const place = cataloguePlace(pack, pid);
    places.set(pid, place);
    anchors.push(
      m.minNights
        ? { id: `anchor_min_${pid}`, kind: 'minimum_nights_at_place', strength: 'hard', placeId: pid, minimumNights: m.minNights, label: `At least ${m.minNights} nights in ${place.name}` }
        : { id: `anchor_req_${pid}`, kind: 'required_place', strength: 'hard', placeId: pid, label: `Visit ${place.name}` },
    );
  }
  for (const a of spec.avoid ?? []) {
    const pid = resolvePlace(pack, a);
    const place = cataloguePlace(pack, pid);
    places.set(pid, place);
    anchors.push({ id: `anchor_avoid_${pid}`, kind: 'excluded_place', strength: 'hard', placeId: pid, label: `Avoid ${place.name}` });
  }
  if (spec.beachNights) anchors.push({ id: 'anchor_beach_nights', kind: 'minimum_consecutive_nights', strength: 'hard', qualifyingTag: 'beach', minimumNights: spec.beachNights, label: `${spec.beachNights} consecutive beach nights` });
  if (spec.beachDays) anchors.push({ id: 'anchor_beach_days', kind: 'minimum_full_days', strength: 'hard', qualifyingTag: 'beach', minimumDays: spec.beachDays, label: `${spec.beachDays} full beach days` });
  (spec.events ?? []).forEach((e, i) => {
    const pid = resolvePlace(pack, e.place);
    const place = cataloguePlace(pack, pid);
    places.set(pid, place);
    if (e.end <= e.start) throw new SpecError(`Event "${e.title}" ends before it starts.`);
    const actId = `event_${i + 1}`;
    activities.push({ id: actId, placeId: pid, title: e.title, start: { localDateTime: e.start, timeZone: place.timeZone }, end: { localDateTime: e.end, timeZone: place.timeZone }, tags: [], lockedFields: ['placeId', 'start', 'end'], dataKind: 'user' });
    anchors.push({ id: `anchor_${actId}`, kind: 'fixed_event', strength: 'hard', activityId: actId, arrivalBufferMinutes: e.arriveEarlyMinutes ?? 60, label: `Be at ${e.title}` });
  });
  (spec.ownPlaces ?? []).forEach((o, i) => {
    const pid = customPlaceId({ places: [...doc.places, ...places.values()] }, o.name, o.timeZone);
    places.set(pid, { id: pid, name: o.name, timeZone: o.timeZone, tags: o.tags ?? [], dataKind: 'user', catalogueId: null, country: null, coordinates: null });
    stays.push({ id: `own_stay_${i + 1}`, placeId: pid, checkIn: o.checkIn, checkOutExclusive: addDays(o.checkIn, o.nights), purposeTags: (o.tags ?? []).slice(0, 4), lockedFields: [], accommodation: null, reason: 'Your own place, outside the catalogue.' });
  });
  doc.places.push(...places.values());
  doc.anchors.push(...anchors);
  doc.activities.push(...activities);
  doc.stays.push(...stays);
  return doc;
}
