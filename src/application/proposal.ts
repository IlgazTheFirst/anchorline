import { z } from 'zod';
import { budgetItemApplicability, claimApplicability } from '../domain/claims';
import { applyCommand, authorize, changesRequirements, command, CommandError, type Actor, type Command } from '../domain/commands';
import { evaluateConstraints, legFeasibility, type ConstraintResult } from '../domain/constraints';
import { formatDate, formatLocal } from '../domain/dates';
import { legElapsedMinutes, placeMap, stayNights, totalHotelNights } from '../domain/derive';
import { checkIntegrity } from '../domain/integrity';
import { budgetSummaryFor, type BudgetSummary } from '../domain/money';
import { tripDocument, type TripDocument } from '../domain/schema';

export const proposalSchema = z
  .object({
    id: z.string().min(1).max(120),
    baseRevision: z.number().int().min(1),
    actor: z.enum(['user', 'planner', 'untrusted_proposal']),
    label: z.string().min(1).max(200),
    rationale: z.string().max(5000).optional(),
    commands: z.array(command).min(1).max(200),
  })
  .strict();

export type Proposal = z.infer<typeof proposalSchema>;

export interface ItemChange {
  id: string;
  label: string;
  change: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

export interface TripDiff {
  stays: ItemChange[];
  nights: { before: number; after: number };
  legs: ItemChange[];
  travel: { knownMinutesBefore: number; knownMinutesAfter: number; unknownBefore: number; unknownAfter: number };
  activities: ItemChange[];
  budget: { before: BudgetSummary; after: BudgetSummary };
  invalidatedEvidence: Array<{ id: string; reason: string }>;
  other: string[];
}

export interface PreviewResult {
  status: 'ready' | 'blocked' | 'stale' | 'rejected' | 'invalid';
  proposal: Proposal | null;
  messages: string[];
  next: TripDocument | null;
  before: ConstraintResult[];
  after: ConstraintResult[];
  newlyViolated: ConstraintResult[];
  stillViolated: ConstraintResult[];
  resolved: ConstraintResult[];
  newlyUnresolved: ConstraintResult[];
  diff: TripDiff | null;
  canApply: boolean;
}

let counter = 0;
export function makeProposal(doc: TripDocument, label: string, commands: Command[], actor: Actor = 'user', rationale?: string): Proposal {
  counter += 1;
  return { id: `p_${doc.revision}_${counter}`, baseRevision: doc.revision, actor, label, rationale, commands };
}

function empty(status: PreviewResult['status'], proposal: Proposal | null, messages: string[], before: ConstraintResult[] = []): PreviewResult {
  return { status, proposal, messages, next: null, before, after: [], newlyViolated: [], stillViolated: [], resolved: [], newlyUnresolved: [], diff: null, canApply: false };
}

/**
 * Validates a proposal and computes what it would do, without saving
 * anything. The accepted document is never mutated here.
 */
export function previewProposal(current: TripDocument, input: unknown): PreviewResult {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) {
    return empty('invalid', null, parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'proposal'}: ${i.message}`));
  }
  const proposal = parsed.data;
  const before = evaluateConstraints(current);
  if (proposal.baseRevision !== current.revision) {
    return empty('stale', proposal, [`This change was prepared for revision ${proposal.baseRevision}, but the plan is now at revision ${current.revision}. Nothing was changed. Review the current plan and try again.`], before);
  }
  const denied = authorize(proposal.commands, proposal.actor, current);
  if (denied.length) return empty('rejected', proposal, denied, before);

  const next = structuredClone(current);
  try {
    for (const c of proposal.commands) applyCommand(next, c, proposal.actor);
  } catch (err) {
    if (err instanceof CommandError) return empty('rejected', proposal, [err.message], before);
    throw err;
  }
  const schemaCheck = tripDocument.safeParse(next);
  const integrity = schemaCheck.success ? checkIntegrity(next) : schemaCheck.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`);
  if (integrity.length) return empty('invalid', proposal, integrity, before);

  const after = evaluateConstraints(next);
  const beforeById = new Map(before.map((r) => [r.id, r]));
  const afterById = new Map(after.map((r) => [r.id, r]));
  const newAnchors = new Set(proposal.commands.filter(changesRequirements).flatMap((c) => (c.type === 'AddAnchor' ? [c.anchor.id] : [])));
  const isBlocking = (r: ConstraintResult) => r.status === 'violated' && r.strength !== 'soft';
  const newlyViolated = after.filter((r) => isBlocking(r) && beforeById.get(r.id)?.status !== 'violated' && !(r.anchorId && newAnchors.has(r.anchorId)));
  const stillViolated = after.filter((r) => isBlocking(r) && !newlyViolated.includes(r));
  const resolved = before.filter((r) => r.status !== 'satisfied' && (afterById.get(r.id)?.status === 'satisfied' || !afterById.has(r.id)));
  const newlyUnresolved = after.filter((r) => r.status === 'unresolved' && beforeById.get(r.id)?.status !== 'unresolved');
  const canApply = newlyViolated.length === 0;
  const messages = canApply
    ? []
    : ['This change would break a commitment, so it cannot replace the current plan. Your current plan is unchanged.', ...newlyViolated.map((r) => `${r.label}: ${r.explanation}`)];
  return {
    status: canApply ? 'ready' : 'blocked',
    proposal,
    messages,
    next,
    before,
    after,
    newlyViolated,
    stillViolated,
    resolved,
    newlyUnresolved,
    diff: diffTrips(current, next),
    canApply,
  };
}

function stayLabel(doc: TripDocument, id: string): string {
  const s = doc.stays.find((x) => x.id === id);
  if (!s) return id;
  return placeMap(doc).get(s.placeId)?.name ?? s.placeId;
}

export function diffTrips(a: TripDocument, b: TripDocument): TripDiff {
  const placesA = placeMap(a);
  const placesB = placeMap(b);
  const stays: ItemChange[] = [];
  const describeStay = (doc: TripDocument, id: string) => {
    const s = doc.stays.find((x) => x.id === id)!;
    const n = stayNights(s);
    return `${(doc === a ? placesA : placesB).get(s.placeId)?.name ?? s.placeId}: ${formatDate(s.checkIn)} → ${formatDate(s.checkOutExclusive)} (${n} night${n === 1 ? '' : 's'})`;
  };
  for (const s of a.stays) {
    const n = b.stays.find((x) => x.id === s.id);
    if (!n) stays.push({ id: s.id, label: stayLabel(a, s.id), change: 'removed', before: describeStay(a, s.id) });
    else if (n.checkIn !== s.checkIn || n.checkOutExclusive !== s.checkOutExclusive || n.placeId !== s.placeId) {
      stays.push({ id: s.id, label: stayLabel(b, s.id), change: 'changed', before: describeStay(a, s.id), after: describeStay(b, s.id) });
    }
  }
  for (const s of b.stays) if (!a.stays.some((x) => x.id === s.id)) stays.push({ id: s.id, label: stayLabel(b, s.id), change: 'added', after: describeStay(b, s.id) });

  const legText = (doc: TripDocument, id: string) => {
    const l = doc.travelLegs.find((x) => x.id === id)!;
    const pm = doc === a ? placesA : placesB;
    const route = `${pm.get(l.fromPlaceId)?.name ?? l.fromPlaceId} → ${pm.get(l.toPlaceId)?.name ?? l.toPlaceId}`;
    const time = l.departure ? `departs ${formatLocal(l.departure.localDateTime)}` : 'time unknown';
    return `${route}, ${l.mode}, ${time}`;
  };
  const legs: ItemChange[] = [];
  for (const l of a.travelLegs) {
    const n = b.travelLegs.find((x) => x.id === l.id);
    if (!n) legs.push({ id: l.id, label: legText(a, l.id), change: 'removed', before: legText(a, l.id) });
    else if (JSON.stringify(n) !== JSON.stringify(l)) legs.push({ id: l.id, label: legText(b, l.id), change: 'changed', before: legText(a, l.id), after: legText(b, l.id) });
  }
  for (const l of b.travelLegs) if (!a.travelLegs.some((x) => x.id === l.id)) legs.push({ id: l.id, label: legText(b, l.id), change: 'added', after: legText(b, l.id) });

  const travelStats = (doc: TripDocument) => {
    let known = 0;
    let unknown = 0;
    for (const l of doc.travelLegs) {
      const m = legElapsedMinutes(l);
      if (m === null || legFeasibility(l).status === 'violated') unknown += 1;
      else known += m;
    }
    return { known, unknown };
  };
  const ta = travelStats(a);
  const tb = travelStats(b);

  const actText = (doc: TripDocument, id: string) => {
    const x = doc.activities.find((y) => y.id === id)!;
    const when = x.start ? formatLocal(x.start.localDateTime) : x.date ? `${formatDate(x.date)}${x.partOfDay ? `, ${x.partOfDay}` : ''}` : 'no date';
    return `${x.title} (${when})`;
  };
  const activities: ItemChange[] = [];
  for (const x of a.activities) {
    const n = b.activities.find((y) => y.id === x.id);
    if (!n) activities.push({ id: x.id, label: x.title, change: 'removed', before: actText(a, x.id) });
    else if (JSON.stringify(n) !== JSON.stringify(x)) activities.push({ id: x.id, label: x.title, change: 'changed', before: actText(a, x.id), after: actText(b, x.id) });
  }
  for (const x of b.activities) if (!a.activities.some((y) => y.id === x.id)) activities.push({ id: x.id, label: x.title, change: 'added', after: actText(b, x.id) });

  const invalidatedEvidence = b.claims
    .filter((c) => {
      const was = a.claims.find((x) => x.id === c.id);
      return (!was || claimApplicability(a, was).applicable) && !claimApplicability(b, c).applicable;
    })
    .map((c) => ({ id: c.id, reason: claimApplicability(b, c).reason ?? '' }));

  const other: string[] = [];
  if (JSON.stringify(a.profile) !== JSON.stringify(b.profile)) other.push('Preferences change.');
  if (a.anchors.length !== b.anchors.length) other.push(`Commitments: ${a.anchors.length} → ${b.anchors.length}.`);
  const locksA = JSON.stringify([a.stays.map((s) => s.lockedFields), a.activities.map((x) => x.lockedFields), a.travelLegs.map((l) => l.lockedFields ?? [])]);
  const locksB = JSON.stringify([b.stays.map((s) => s.lockedFields), b.activities.map((x) => x.lockedFields), b.travelLegs.map((l) => l.lockedFields ?? [])]);
  if (locksA !== locksB) other.push('Locks change.');
  if (a.title !== b.title) other.push(`Title: “${a.title}” → “${b.title}”.`);
  if (JSON.stringify(a.travellers) !== JSON.stringify(b.travellers)) other.push(`Travellers: ${a.travellers.count} → ${b.travellers.count}, rooms ${a.travellers.rooms} → ${b.travellers.rooms}.`);
  if (a.bookingMarks.length !== b.bookingMarks.length) other.push('Your booking records change.');
  if (a.budgetItems.length !== b.budgetItems.length) other.push(`Budget lines: ${a.budgetItems.length} → ${b.budgetItems.length}.`);

  return {
    stays,
    nights: { before: totalHotelNights(a), after: totalHotelNights(b) },
    legs,
    travel: { knownMinutesBefore: ta.known, knownMinutesAfter: tb.known, unknownBefore: ta.unknown, unknownAfter: tb.unknown },
    activities,
    budget: {
      before: budgetSummaryFor(a, (i) => budgetItemApplicability(a, i).applicable),
      after: budgetSummaryFor(b, (i) => budgetItemApplicability(b, i).applicable),
    },
    invalidatedEvidence,
    other,
  };
}
