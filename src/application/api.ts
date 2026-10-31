import { budgetItemApplicability } from '../domain/claims';
import type { Actor } from '../domain/commands';
import { evaluateConstraints, type ConstraintResult } from '../domain/constraints';
import { dayCards, sortStays, stayNights, totalHotelNights } from '../domain/derive';
import { formatDate, formatLocal, formatMinutes, formatZoned } from '../domain/dates';
import { budgetSummaryFor } from '../domain/money';
import { presetById } from '../domain/presets';
import type { TripDocument } from '../domain/schema';
import type { DestinationPack } from '../catalogue/schema';
import { planForTrip, planToCommands } from '../planner/fromTrip';
import type { PlanResult } from '../planner/types';
import { makeProposal, previewProposal, type PreviewResult } from './proposal';
import { buildShareable, parseImport, type ShareOptions, type ShareableTrip } from './transfer';
import { SpecError, tripFromSpec, tripSpec } from './tripSpec';

/**
 * Operations shared by the command line and the MCP server. Pure: no files,
 * no network. Nothing here can create a booking, a quote or a checked
 * timetable; changes from outside are treated as untrusted suggestions.
 */

export const HONESTY_NOTE =
  'Nothing here is booked. Travel times are planning estimates from documented routes, not timetables or fares. Prices are unknown unless you add them.';

export class InputError extends Error {}

export interface CheckSummary {
  counts: { satisfied: number; violated: number; unresolved: number };
  results: Array<Pick<ConstraintResult, 'label' | 'status' | 'explanation' | 'relaxations' | 'strength'> & { id: string }>;
}

export function summariseChecks(results: ConstraintResult[]): CheckSummary {
  const order = { violated: 0, unresolved: 1, satisfied: 2 } as const;
  return {
    counts: {
      satisfied: results.filter((r) => r.status === 'satisfied').length,
      violated: results.filter((r) => r.status === 'violated').length,
      unresolved: results.filter((r) => r.status === 'unresolved').length,
    },
    results: [...results]
      .sort((a, b) => order[a.status] - order[b.status])
      .map((r) => ({ id: r.id, label: r.label, status: r.status, strength: r.strength, explanation: r.explanation, relaxations: r.relaxations })),
  };
}

/** Accepts a trip document, a private backup, or the output of plan_trip/`anchorline plan --json`. */
export function loadTrip(input: unknown): TripDocument {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new InputError('The trip is not valid JSON.');
    }
  }
  if (value && typeof value === 'object' && 'trip' in value && (value as { trip: unknown }).trip && typeof (value as { trip: unknown }).trip === 'object') {
    value = (value as { trip: unknown }).trip;
  }
  const r = parseImport(JSON.stringify(value ?? null), new Set());
  if (!r.ok) throw new InputError(`Not a valid Anchorline trip: ${r.errors.join(' ')}`);
  return r.doc;
}

export function listPlaces(pack: DestinationPack, country?: string) {
  const places = pack.places
    .filter((p) => !country || p.country.toLowerCase() === country.toLowerCase())
    .map((p) => ({
      id: p.id,
      name: p.name,
      country: p.country,
      timeZone: p.timeZone,
      tags: p.tags,
      recommendedNights: p.recommendedNights,
      gateway: p.gateway,
      airports: p.airports,
      summary: p.summary,
      seasonNote: p.seasonGuidance?.note ?? null,
      sources: p.sourceUrls,
      checkedAt: p.checkedAt,
    }));
  return {
    pack: { id: pack.packId, title: pack.title, version: pack.version, checkedAt: pack.checkedAt },
    coverage: `${pack.coverage.description} Anywhere else, add your own places by hand; there are no routes, activities or season notes for them.`,
    places,
  };
}

export interface PlanOutput {
  status: 'ok' | 'infeasible' | 'invalid';
  summary: string;
  reasons: string[];
  stillToCheck: string[];
  conflicts: PlanResult['conflicts'];
  alternatives: PlanResult['alternatives'];
  problems: string[];
  checks: CheckSummary | null;
  honesty: string;
  trip: TripDocument | null;
}

/** Plans from a trip spec or re-plans an existing trip document. */
export function planTrip(input: unknown, pack: DestinationPack, options: { sequence?: string[] } = {}): PlanOutput {
  let doc: TripDocument;
  const looksLikeTrip = Boolean(input && typeof input === 'object' && ('schemaVersion' in input || 'trip' in input || 'document' in input));
  try {
    if (looksLikeTrip) doc = loadTrip(input);
    else {
      const parsed = tripSpec.safeParse(input);
      if (!parsed.success) {
        return invalid(parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'spec'}: ${i.message}`));
      }
      doc = tripFromSpec(parsed.data, pack);
    }
  } catch (err) {
    if (err instanceof SpecError || err instanceof InputError) return invalid([err.message]);
    throw err;
  }
  const { result, problems } = planForTrip(doc, pack, options.sequence ? { sequence: options.sequence } : {});
  if (!result) return { ...invalid(problems), trip: doc };
  if (result.status !== 'ok') {
    return { status: 'infeasible', summary: result.summary, reasons: [], stillToCheck: [], conflicts: result.conflicts, alternatives: [], problems, checks: null, honesty: HONESTY_NOTE, trip: doc };
  }
  const preview = previewProposal(doc, makeProposal(doc, 'Generate a plan', planToCommands(result), 'planner'));
  if (!preview.next || !preview.canApply) return { ...invalid(preview.messages), trip: doc };
  const trip = { ...preview.next, revision: doc.revision + 1 };
  return {
    status: 'ok',
    summary: result.summary,
    reasons: result.reasons,
    stillToCheck: result.unresolved,
    conflicts: [],
    alternatives: result.alternatives,
    problems,
    checks: summariseChecks(evaluateConstraints(trip)),
    honesty: HONESTY_NOTE,
    trip,
  };
}

function invalid(problems: string[]): PlanOutput {
  return { status: 'invalid', summary: 'The trip description is not valid.', reasons: [], stillToCheck: [], conflicts: [], alternatives: [], problems, checks: null, honesty: HONESTY_NOTE, trip: null };
}

export function checkTrip(input: unknown) {
  const trip = loadTrip(input);
  return { title: trip.title, revision: trip.revision, nights: totalHotelNights(trip), ...summariseChecks(evaluateConstraints(trip)), honesty: HONESTY_NOTE };
}

export interface PreviewOutput {
  status: PreviewResult['status'];
  canApply: boolean;
  label: string;
  actor: Actor;
  messages: string[];
  changes: { nights: { before: number; after: number } | null; stays: string[]; journeys: string[]; activities: string[]; other: string[]; evidenceToRecheck: string[] };
  newlyBroken: CheckSummary['results'];
  newlyUnresolved: CheckSummary['results'];
  resolved: string[];
  next: TripDocument | null;
}

/**
 * Previews commands against a trip without saving anything. By default the
 * proposal is untrusted: it cannot record bookings, mark quotes or checked
 * timetables, unlock fields or remove hard commitments.
 */
export function previewChange(tripInput: unknown, change: unknown, options: { actor?: Actor } = {}): PreviewOutput {
  const trip = loadTrip(tripInput);
  const actor: Actor = options.actor ?? 'untrusted_proposal';
  let commands: unknown;
  let label = 'Proposed change';
  let baseRevision = trip.revision;
  if (Array.isArray(change)) commands = change;
  else if (change && typeof change === 'object' && 'commands' in change) {
    const c = change as { commands: unknown; label?: unknown; baseRevision?: unknown };
    commands = c.commands;
    if (typeof c.label === 'string' && c.label.trim()) label = c.label.slice(0, 200);
    if (typeof c.baseRevision === 'number') baseRevision = c.baseRevision;
  } else commands = [change];
  const p = previewProposal(trip, { id: 'external', baseRevision, actor, label, commands });
  const fmt = (r: ConstraintResult) => ({ id: r.id, label: r.label, status: r.status, strength: r.strength, explanation: r.explanation, relaxations: r.relaxations });
  const text = (c: { change: string; before?: string; after?: string }) => (c.change === 'removed' ? `Removed: ${c.before}` : c.change === 'added' ? `Added: ${c.after}` : `Changed: ${c.before} → ${c.after}`);
  return {
    status: p.status,
    canApply: p.canApply,
    label,
    actor,
    messages: p.messages,
    changes: {
      nights: p.diff ? p.diff.nights : null,
      stays: p.diff?.stays.map(text) ?? [],
      journeys: p.diff?.legs.map(text) ?? [],
      activities: p.diff?.activities.map(text) ?? [],
      other: p.diff?.other ?? [],
      evidenceToRecheck: p.diff?.invalidatedEvidence.map((e) => `${e.id}: ${e.reason}`) ?? [],
    },
    newlyBroken: p.newlyViolated.map(fmt),
    newlyUnresolved: p.newlyUnresolved.map(fmt),
    resolved: p.resolved.map((r) => r.label),
    next: p.canApply && p.next ? { ...p.next, revision: trip.revision + 1 } : null,
  };
}

export function shareExport(tripInput: unknown, options: Partial<ShareOptions> = {}): ShareableTrip {
  return buildShareable(loadTrip(tripInput), { omitExactDates: Boolean(options.omitExactDates), omitAccommodation: options.omitAccommodation ?? true, omitCosts: Boolean(options.omitCosts) });
}

// ---------- Plain-text rendering ----------

const STATUS_MARK = { satisfied: '✓ met', violated: '✕ broken', unresolved: '? unresolved' } as const;

export function placesText(out: ReturnType<typeof listPlaces>): string {
  const lines = [`${out.pack.title} (pack ${out.pack.version}, sources checked ${out.pack.checkedAt})`, out.coverage, ''];
  for (const p of out.places) {
    lines.push(`${p.name} [${p.id}] · ${p.country} · ${p.tags.join(', ')} · ${p.recommendedNights.min}-${p.recommendedNights.max} nights${p.airports.length ? ` · ${p.airports.join('/')}` : ''}`);
    lines.push(`  ${p.summary}`);
  }
  return lines.join('\n');
}

export function checksText(c: CheckSummary): string {
  const lines = [`Checks: ${c.counts.violated} broken, ${c.counts.unresolved} unresolved, ${c.counts.satisfied} met`];
  for (const r of c.results) {
    lines.push(`  ${STATUS_MARK[r.status]}  ${r.label}: ${r.explanation}`);
    if (r.status !== 'satisfied') for (const x of r.relaxations) lines.push(`      → ${x}`);
  }
  return lines.join('\n');
}

export function planText(out: PlanOutput): string {
  if (out.status === 'invalid') return ['Could not plan this trip.', ...out.problems.map((p) => `  - ${p}`)].join('\n');
  if (out.status === 'infeasible') {
    const lines = ['No plan meets every commitment. Nothing was relaxed.'];
    for (const c of out.conflicts) {
      lines.push(`  ${c.title}: ${c.explanation}`);
      for (const r of c.relaxations) lines.push(`    → ${r}`);
    }
    return lines.join('\n');
  }
  const trip = out.trip!;
  const name = (id: string) => trip.places.find((p) => p.id === id)?.name ?? id;
  const lines = [`${trip.title}: ${out.summary}`, `Style: ${presetById(trip.profile.presetId).name}, ${trip.profile.pace} pace.`, '', 'Why this plan'];
  for (const r of out.reasons) lines.push(`  - ${r}`);
  lines.push('', 'Stays');
  for (const s of sortStays(trip.stays)) {
    lines.push(`  ${formatDate(s.checkIn)} → ${formatDate(s.checkOutExclusive)}  ${name(s.placeId)} (${stayNights(s)} night${stayNights(s) === 1 ? '' : 's'})`);
    if (s.reason) lines.push(`      ${s.reason}`);
  }
  lines.push('', 'Journeys (no times or fares yet)');
  for (const l of trip.travelLegs) {
    const est = l.durationRangeMinutes ? `, about ${formatMinutes(l.durationRangeMinutes.min)}–${formatMinutes(l.durationRangeMinutes.max)} (planning estimate)` : '';
    const when = l.departure ? `, departs ${formatZoned(l.departure)}` : '';
    lines.push(`  ${name(l.fromPlaceId)} → ${name(l.toPlaceId)}: ${l.mode}${est}${when}`);
  }
  lines.push('', 'Day by day');
  for (const c of dayCards(trip)) {
    const acts = c.activities.map((a) => `${a.start ? formatLocal(a.start.localDateTime).split(' ').pop() : (a.partOfDay ?? 'any time')}: ${a.title}`);
    const where = c.placeIds.map(name).join(' → ') || 'travelling';
    const free = c.isFullDay && c.freeParts.length ? ` · free ${c.freeParts.join(', ')}` : '';
    lines.push(`  ${formatDate(c.date)}  ${where}${c.isTransferDay ? ' · travel day' : ''}${free}`);
    for (const a of acts) lines.push(`      ${a}`);
  }
  if (out.stillToCheck.length) {
    lines.push('', 'Still to check');
    for (const u of out.stillToCheck) lines.push(`  - ${u}`);
  }
  if (out.alternatives.length) {
    lines.push('', 'Other routes considered');
    for (const a of out.alternatives) lines.push(`  - ${a.summary} (score ${a.scoreDelta.toFixed(2)})`);
  }
  const budget = budgetSummaryFor(trip, (i) => budgetItemApplicability(trip, i).applicable);
  lines.push('', budget.byCurrency.length ? `Budget: ${budget.notes.join(' ')}` : 'Budget: no prices yet.');
  if (out.checks) lines.push('', checksText(out.checks));
  lines.push('', out.honesty);
  return lines.join('\n');
}

export function previewText(p: PreviewOutput): string {
  const head = {
    ready: 'Ready to apply. Nothing has been saved.',
    blocked: 'Blocked: this change would break a commitment. Nothing has been saved.',
    stale: 'Stale: this change was prepared for an older revision. Nothing has been saved.',
    rejected: 'Rejected. Nothing has been saved.',
    invalid: 'Invalid change. Nothing has been saved.',
  }[p.status];
  const lines = [`Preview: ${p.label}`, head];
  for (const m of p.messages) lines.push(`  - ${m}`);
  if (p.changes.nights) lines.push(`Nights: ${p.changes.nights.before} → ${p.changes.nights.after}`);
  for (const [title, list] of [
    ['Stays', p.changes.stays],
    ['Journeys', p.changes.journeys],
    ['Activities', p.changes.activities],
    ['Other', p.changes.other],
    ['Evidence to check again', p.changes.evidenceToRecheck],
  ] as const) {
    if (!list.length) continue;
    lines.push(title);
    for (const x of list) lines.push(`  ${x}`);
  }
  if (p.newlyBroken.length) {
    lines.push('Would break');
    for (const r of p.newlyBroken) {
      lines.push(`  ✕ ${r.label}: ${r.explanation}`);
      for (const x of r.relaxations) lines.push(`      → ${x}`);
    }
  }
  if (p.newlyUnresolved.length) {
    lines.push('New open questions');
    for (const r of p.newlyUnresolved.slice(0, 10)) lines.push(`  ? ${r.label}: ${r.explanation}`);
  }
  if (p.resolved.length) lines.push(`Resolves: ${p.resolved.join(', ')}`);
  return lines.join('\n');
}
