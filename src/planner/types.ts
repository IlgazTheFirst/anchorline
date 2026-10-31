import type { DestinationPack } from '../catalogue/schema';
import type { Activity, Claim, Place, Profile, Stay, TravelLeg } from '../domain/schema';

/** A place that must hold specific nights: a fixed event, protected rest or a locked stay. */
export interface Pin {
  placeId: string;
  firstNight: string;
  lastNight: string;
  /** Exact pins (locked stay dates) must start and end on these nights. */
  exact: boolean;
  reason: string;
  sourceId: string;
}

export interface PlanRequest {
  pack: DestinationPack;
  firstNight: string;
  leaveDate: string;
  departureDate: string;
  home: Place;
  profile: Profile;
  travellers: number;
  requiredPlaceIds: string[];
  excludedPlaceIds: string[];
  minNights: Record<string, number>;
  pins: Pin[];
  consecutive: Array<{ tag: string; minimumNights: number; anchorId: string }>;
  fullDays: Array<{ tag: string; minimumDays: number; anchorId: string }>;
  /** Places the trip must start or end at, when the traveller has chosen them. */
  arrivalGatewayId: string | null;
  departureGatewayId: string | null;
  /** Places outside the catalogue that the traveller has added (manual planning only). */
  customPlaces: Place[];
  /** Existing stays to reuse when the plan keeps their exact dates: locked stays and stays at the traveller's own places. */
  lockedStays: Stay[];
  lockedLegs: TravelLeg[];
  keptActivities: Activity[];
  /** Unlocked activities the traveller added; kept when the new plan still has them in that place on that date. */
  userActivities: Activity[];
  homeDeadlineDate: string | null;
  maxStops?: number;
}

export interface StopPlan {
  placeId: string;
  checkIn: string;
  checkOutExclusive: string;
  nights: number;
  reasons: string[];
}

export interface Conflict {
  title: string;
  explanation: string;
  relaxations: string[];
  constraintIds: string[];
}

export interface Alternative {
  summary: string;
  scoreDelta: number;
  places: string[];
}

export interface ScoreBreakdown {
  total: number;
  enjoyment: number;
  variety: number;
  movesPenalty: number;
  transferPenalty: number;
  gatewayPenalty: number;
}

export interface PlanResult {
  status: 'ok' | 'infeasible';
  stops: StopPlan[];
  places: Place[];
  stays: Stay[];
  travelLegs: TravelLeg[];
  activities: Activity[];
  claims: Claim[];
  summary: string;
  reasons: string[];
  unresolved: string[];
  conflicts: Conflict[];
  alternatives: Alternative[];
  score: ScoreBreakdown | null;
  coverage: { packId: string; packTitle: string; version: string; outside: string[] };
}
