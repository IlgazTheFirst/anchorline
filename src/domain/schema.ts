import { z } from 'zod';
import { isValidLocalDateTime, isValidPlainDate, isValidTimeZone } from './dates';

/** Current trip document schema. Bump with a migration in storage/ and import/. */
export const SCHEMA_VERSION = 1 as const;

export const LIMITS = {
  places: 300,
  stays: 200,
  travelLegs: 300,
  activities: 1000,
  anchors: 100,
  claims: 2000,
  budgetItems: 1000,
  bookingMarks: 500,
  privateNotes: 500,
  tags: 30,
  shortText: 200,
  longText: 5000,
  importBytes: 2_000_000,
} as const;

const id = z.string().min(1).max(120).regex(/^[A-Za-z0-9_.:-]+$/, 'IDs use letters, digits, _ . : -');
const shortText = z.string().max(LIMITS.shortText);
const longText = z.string().max(LIMITS.longText);
const tag = z.string().min(1).max(40);
const tags = z.array(tag).max(LIMITS.tags);

export const plainDate = z.string().refine(isValidPlainDate, 'Expected a calendar date like 2030-06-11');
export const localDateTime = z.string().refine(isValidLocalDateTime, 'Expected a local date-time like 2030-06-11T14:00');
export const timeZone = z.string().max(64).refine(isValidTimeZone, 'Unknown IANA time zone');

/** Only plain web links may be stored or rendered as links. */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
export const safeUrl = z.string().max(2000).refine(isSafeHttpUrl, 'Only http(s) links are allowed');

export const zonedTime = z.object({
  localDateTime,
  timeZone,
  offset: z.string().regex(/^[+-]\d{2}:\d{2}$/).nullable().optional(),
});

export const dataKind = z.enum(['synthetic', 'curated', 'user']);

export const place = z.object({
  id,
  name: shortText.min(1),
  timeZone,
  tags,
  dataKind,
  catalogueId: id.nullable().optional(),
  country: shortText.nullable().optional(),
  coordinates: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), sourceUrl: safeUrl }).nullable().optional(),
});

export const lockableStayField = z.enum(['placeId', 'checkIn', 'checkOutExclusive']);
export const stay = z.object({
  id,
  placeId: id,
  checkIn: plainDate,
  checkOutExclusive: plainDate,
  purposeTags: tags,
  lockedFields: z.array(lockableStayField).max(3),
  accommodation: z.object({ name: shortText, address: shortText.optional(), notes: longText.optional() }).nullable().optional(),
  reason: longText.nullable().optional(),
});

export const timingStatus = z.enum(['synthetic_planning_assumption', 'planning_assumption', 'user_entered', 'unknown']);
export const travelLeg = z.object({
  id,
  fromPlaceId: id,
  toPlaceId: id,
  mode: shortText.min(1),
  departure: zonedTime.nullable(),
  arrival: zonedTime.nullable(),
  durationRangeMinutes: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }).nullable().optional(),
  preDepartureBufferMinutes: z.number().int().min(0).max(24 * 60),
  postArrivalBufferMinutes: z.number().int().min(0).max(24 * 60),
  timingStatus,
  identifiers: z.object({ from: shortText.optional(), to: shortText.optional(), service: shortText.optional() }).nullable().optional(),
  evidenceIds: z.array(id).max(50),
  lockedFields: z.array(z.enum(['departure', 'arrival'])).max(2).optional(),
  note: longText.nullable().optional(),
});

export const partOfDay = z.enum(['morning', 'afternoon', 'evening', 'night', 'any']);
export const activity = z.object({
  id,
  placeId: id,
  title: shortText.min(1),
  start: zonedTime.nullable().optional(),
  end: zonedTime.nullable().optional(),
  date: plainDate.nullable().optional(),
  partOfDay: partOfDay.nullable().optional(),
  durationMinutes: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }).nullable().optional(),
  tags,
  lockedFields: z.array(z.enum(['placeId', 'start', 'end', 'date'])).max(4),
  dataKind,
  catalogueActivityId: id.nullable().optional(),
  evidenceIds: z.array(id).max(50).optional(),
  note: longText.nullable().optional(),
});

const anchorBase = { id, strength: z.enum(['hard', 'soft']), label: shortText.optional() };
export const anchor = z.discriminatedUnion('kind', [
  z.object({ ...anchorBase, kind: z.literal('fixed_event'), activityId: id, arrivalBufferMinutes: z.number().int().min(0).max(24 * 60).optional() }),
  z.object({ ...anchorBase, kind: z.literal('minimum_consecutive_nights'), qualifyingTag: tag, minimumNights: z.number().int().min(1).max(365) }),
  z.object({ ...anchorBase, kind: z.literal('minimum_full_days'), qualifyingTag: tag, minimumDays: z.number().int().min(1).max(365) }),
  z.object({ ...anchorBase, kind: z.literal('minimum_nights_at_place'), placeId: id, minimumNights: z.number().int().min(1).max(365) }),
  z.object({ ...anchorBase, kind: z.literal('required_place'), placeId: id }),
  z.object({ ...anchorBase, kind: z.literal('excluded_place'), placeId: id }),
  z.object({
    ...anchorBase,
    kind: z.literal('arrival_deadline'),
    placeId: id,
    deadline: zonedTime,
    endpoint: shortText.optional(),
    includePostArrivalBuffer: z.boolean(),
  }),
  z.object({ ...anchorBase, kind: z.literal('protected_rest'), placeId: id, start: zonedTime, end: zonedTime }),
]);

/**
 * Evidence ladder. Only a person can record a dated quote or a booking;
 * planner output and untrusted proposals stop at planning assumptions.
 */
export const evidenceStatus = z.enum([
  'synthetic',
  'planning_assumption',
  'source_documented',
  'dated_schedule',
  'live_quote',
  'user_recorded',
]);
export const claim = z.object({
  id,
  subjectId: id,
  kind: z.enum(['route_timing', 'route_existence', 'price', 'place_info', 'activity_info', 'schedule', 'transfer']),
  evidenceStatus,
  sourceUrl: safeUrl.nullable(),
  checkedAt: plainDate.nullable(),
  validFrom: plainDate.nullable().optional(),
  validUntil: plainDate.nullable().optional(),
  dataKind,
  dependsOn: z
    .object({
      placeId: id.optional(),
      fromPlaceId: id.optional(),
      toPlaceId: id.optional(),
      departureLocalDate: plainDate.optional(),
      checkIn: plainDate.optional(),
      checkOutExclusive: plainDate.optional(),
      travellerCount: z.number().int().min(1).optional(),
    })
    .optional(),
  note: longText.nullable().optional(),
});

export const priceBasis = z.enum(['per_room_night', 'per_person', 'per_person_night', 'per_booking', 'per_journey', 'per_room']);
export const budgetStatus = z.enum(['user_allowance', 'catalogue_estimate', 'synthetic_allowance', 'dated_quote', 'booked_cost', 'unknown']);
export const budgetItem = z.object({
  id,
  subjectId: id.nullable(),
  label: shortText.min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  minorUnitDigits: z.number().int().min(0).max(4),
  unitAmountMinor: z.number().int().min(0).nullable(),
  unitAmountMaxMinor: z.number().int().min(0).nullable().optional(),
  priceBasis,
  quantity: z.object({
    rooms: z.number().int().min(0).max(100).optional(),
    nights: z.number().int().min(0).max(366).optional(),
    people: z.number().int().min(0).max(100).optional(),
    bookings: z.number().int().min(0).max(100).optional(),
    journeys: z.number().int().min(0).max(100).optional(),
  }),
  status: budgetStatus,
  evidenceIds: z.array(id).max(20).optional(),
  dependsOn: claim.shape.dependsOn,
});

export const bookingMark = z.object({
  id,
  subjectId: id,
  status: z.enum(['booked', 'held', 'cancelled']),
  recordedAt: z.string().max(40),
  recordedBy: z.literal('user'),
  reference: shortText.optional(),
  provider: shortText.optional(),
  note: longText.optional(),
});

export const profile = z.object({
  presetId: id,
  weights: z.object({
    food: z.number().min(0).max(3),
    nightlife: z.number().min(0).max(3),
    beach: z.number().min(0).max(3),
    culture: z.number().min(0).max(3),
    nature: z.number().min(0).max(3),
    adventure: z.number().min(0).max(3),
    city: z.number().min(0).max(3),
    relax: z.number().min(0).max(3),
  }),
  pace: z.enum(['slow', 'balanced', 'fast']),
  protectRecoveryTime: z.boolean(),
  alcoholPreference: z.enum(['unspecified', 'avoid_alcohol_focused']),
  familyFriendly: z.boolean(),
  accessibility: z.object({ stepFreeNeeded: z.boolean(), note: longText.optional() }),
});

export const budgetSettings = z.object({
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  targetAmountMinor: z.number().int().min(0).nullable(),
  basis: z.enum(['whole_group', 'per_person']),
  fx: z
    .array(
      z.object({
        from: z.string().regex(/^[A-Z]{3}$/),
        to: z.string().regex(/^[A-Z]{3}$/),
        rate: z.number().positive(),
        asOf: plainDate,
        source: z.literal('user_entered'),
      }),
    )
    .max(20),
});

export const planWindow = z.object({
  firstNight: plainDate,
  leaveDate: plainDate,
  arrivalGatewayId: id.nullable().optional(),
  departureGatewayId: id.nullable().optional(),
});

export const tripDocument = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id,
  revision: z.number().int().min(1),
  title: shortText.min(1),
  isSynthetic: z.boolean(),
  homePlaceId: id,
  departureDate: plainDate,
  window: planWindow.nullable(),
  travellers: z.object({ count: z.number().int().min(1).max(50), rooms: z.number().int().min(1).max(50) }),
  budget: budgetSettings,
  profile,
  places: z.array(place).max(LIMITS.places),
  stays: z.array(stay).max(LIMITS.stays),
  travelLegs: z.array(travelLeg).max(LIMITS.travelLegs),
  activities: z.array(activity).max(LIMITS.activities),
  anchors: z.array(anchor).max(LIMITS.anchors),
  claims: z.array(claim).max(LIMITS.claims),
  budgetItems: z.array(budgetItem).max(LIMITS.budgetItems),
  bookingMarks: z.array(bookingMark).max(LIMITS.bookingMarks),
  travellerDetails: z.object({ names: z.array(shortText).max(50), contacts: z.array(shortText).max(50) }),
  privateNotes: z.array(z.object({ id, subjectId: id.nullable(), text: longText })).max(LIMITS.privateNotes),
  catalogue: z.object({ packId: id, version: shortText }).nullable(),
  planExplanation: z
    .object({ summary: longText, reasons: z.array(longText).max(100), unresolved: z.array(longText).max(100) })
    .nullable()
    .optional(),
  updatedAt: z.string().max(40).optional(),
});

export type ZonedTimeT = z.infer<typeof zonedTime>;
export type Place = z.infer<typeof place>;
export type Stay = z.infer<typeof stay>;
export type TravelLeg = z.infer<typeof travelLeg>;
export type Activity = z.infer<typeof activity>;
export type Anchor = z.infer<typeof anchor>;
export type Claim = z.infer<typeof claim>;
export type EvidenceStatus = z.infer<typeof evidenceStatus>;
export type BudgetItem = z.infer<typeof budgetItem>;
export type BudgetStatus = z.infer<typeof budgetStatus>;
export type BookingMark = z.infer<typeof bookingMark>;
export type Profile = z.infer<typeof profile>;
export type Interest = keyof Profile['weights'];
export type TripDocument = z.infer<typeof tripDocument>;
export type PartOfDay = z.infer<typeof partOfDay>;

export const INTERESTS: Interest[] = ['food', 'nightlife', 'beach', 'culture', 'nature', 'adventure', 'city', 'relax'];
