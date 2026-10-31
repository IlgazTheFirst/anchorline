import { addDays } from '../domain/dates';
import { presetById } from '../domain/presets';
import { SCHEMA_VERSION, type Anchor, type Place, type Profile, type TripDocument } from '../domain/schema';

export interface NewTripInput {
  title: string;
  homeName: string;
  homeTimeZone: string;
  departureDate: string;
  firstNight: string;
  leaveDate: string;
  homeBy: { localDateTime: string; bufferMinutes: number } | null;
  travellers: number;
  rooms: number;
  currency: string;
  budgetAmountMinor: number | null;
  budgetBasis: 'whole_group' | 'per_person';
  profile: Profile;
  arrivalGatewayId?: string | null;
  departureGatewayId?: string | null;
}

export function newId(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
}

export function createTrip(input: NewTripInput, id = newId('trip')): TripDocument {
  const home: Place = { id: 'home', name: input.homeName || 'Home', timeZone: input.homeTimeZone, tags: ['home'], dataKind: 'user', catalogueId: null, country: null, coordinates: null };
  const anchors: Anchor[] = [];
  if (input.homeBy) {
    anchors.push({
      id: 'anchor_home_deadline',
      kind: 'arrival_deadline',
      strength: 'hard',
      label: 'Home deadline',
      placeId: 'home',
      deadline: { localDateTime: input.homeBy.localDateTime, timeZone: input.homeTimeZone },
      endpoint: `${input.homeName || 'home'}, after the final transfer`,
      includePostArrivalBuffer: true,
    });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    revision: 1,
    title: input.title || 'My trip',
    isSynthetic: false,
    homePlaceId: 'home',
    departureDate: input.departureDate,
    window: { firstNight: input.firstNight, leaveDate: input.leaveDate, arrivalGatewayId: input.arrivalGatewayId ?? null, departureGatewayId: input.departureGatewayId ?? null },
    travellers: { count: input.travellers, rooms: input.rooms },
    budget: { baseCurrency: input.currency, targetAmountMinor: input.budgetAmountMinor, basis: input.budgetBasis, fx: [] },
    profile: input.profile,
    places: [home],
    stays: [],
    travelLegs: [],
    activities: [],
    anchors,
    claims: [],
    budgetItems: [],
    bookingMarks: [],
    travellerDetails: { names: [], contacts: [] },
    privateNotes: [],
    catalogue: null,
    planExplanation: null,
  };
}

export function defaultNewTripInput(today: string, homeTimeZone: string): NewTripInput {
  const departure = addDays(today, 60);
  return {
    title: '',
    homeName: '',
    homeTimeZone,
    departureDate: departure,
    firstNight: addDays(departure, 1),
    leaveDate: addDays(departure, 15),
    homeBy: { localDateTime: `${addDays(departure, 16)}T23:00`, bufferMinutes: 60 },
    travellers: 2,
    rooms: 1,
    currency: 'GBP',
    budgetAmountMinor: null,
    budgetBasis: 'whole_group',
    profile: structuredClone(presetById('a_bit_of_everything').profile),
  };
}
