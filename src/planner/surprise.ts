import type { DestinationPack } from '../catalogue/schema';
import type { Command } from '../domain/commands';
import { addDays, compareDates, datesInRange, dayOfWeek, formatDate, localDateOf, resolveZoned, dateInZone } from '../domain/dates';
import { dayCards } from '../domain/derive';
import type { Activity, PartOfDay, TripDocument } from '../domain/schema';
import { activityAllowed, effectiveWeights } from './score';

export interface Surprise {
  key: string;
  title: string;
  placeName: string;
  date: string;
  partOfDay: PartOfDay;
  reason: string;
  timeNote: string;
  budgetNote: string;
  sourceUrl: string;
  commands: Command[];
}

export const MAX_SURPRISES = 3;

/**
 * Up to three optional experiences that fit the traveller's interests, sit
 * on a genuinely free day, avoid fixed commitments and protected rest, and
 * respect day-of-week schedules. `round` rotates deterministically through
 * further suggestions. Each one is a proposal, never an automatic change.
 */
export function suggestSurprises(doc: TripDocument, pack: DestinationPack, round = 0): Surprise[] {
  const weights = effectiveWeights(doc.profile);
  const inPlan = new Set(doc.activities.map((a) => a.catalogueActivityId).filter(Boolean));
  const coveredTags = new Set(doc.activities.flatMap((a) => a.tags));
  const cards = dayCards(doc);
  const busy = new Set<string>();
  for (const an of doc.anchors) {
    if (an.kind === 'protected_rest') {
      const s = resolveZoned(an.start);
      const e = resolveZoned(an.end);
      const place = doc.places.find((p) => p.id === an.placeId);
      if (s.status === 'ok' && e.status === 'ok' && place) {
        for (const d of datesInRange(dateInZone(s.instant, place.timeZone), addDays(dateInZone(e.instant, place.timeZone), 1))) busy.add(d);
      }
    }
    if (an.kind === 'fixed_event') {
      const act = doc.activities.find((a) => a.id === an.activityId);
      if (act?.start) busy.add(localDateOf(act.start));
      if (act?.end) busy.add(localDateOf(act.end));
    }
  }
  const options: Array<Surprise & { score: number }> = [];
  for (const stay of doc.stays) {
    const place = doc.places.find((p) => p.id === stay.placeId);
    const catId = place?.catalogueId ?? stay.placeId;
    const catPlace = pack.places.find((p) => p.id === catId);
    if (!place || !catPlace) continue;
    const freeDays = cards.filter((c) => c.stayId === stay.id && c.isFullDay && !busy.has(c.date) && c.activities.length < 2 && compareDates(c.date, stay.checkIn) > 0);
    for (const a of pack.activities.filter((x) => x.placeId === catId)) {
      if (inPlan.has(a.id) || a.recurrence || !activityAllowed(a, doc.profile).ok) continue;
      const interest = a.tags.reduce((s, t) => s + weights[t], 0) / a.tags.length;
      if (interest < 1.5) continue;
      const day = freeDays.find((c) => (!a.daysOfWeek || a.daysOfWeek.includes(dayOfWeek(c.date))) && (a.partOfDay !== 'any' || c.activities.length === 0));
      if (!day) continue;
      const novel = a.tags.filter((t) => !coveredTags.has(t));
      const score = a.distinctive + interest * 0.6 + novel.length * 0.8;
      const part: PartOfDay = a.partOfDay === 'night' ? 'evening' : a.partOfDay === 'any' ? 'any' : a.partOfDay;
      const id = `surprise_${a.id}_${day.date}`;
      const claimId = `claim_${id}`;
      const activity: Activity = {
        id,
        placeId: place.id,
        title: a.title,
        start: null,
        end: null,
        date: day.date,
        partOfDay: part,
        durationMinutes: { min: Math.round(a.durationHours.min * 60), max: Math.round(a.durationHours.max * 60) },
        tags: [...a.tags],
        lockedFields: [],
        dataKind: 'curated',
        catalogueActivityId: a.id,
        evidenceIds: [claimId],
        note: null,
      };
      const why = novel.length
        ? `Adds ${novel.join(' and ')}, which your plan does not have yet`
        : `Matches your interest in ${a.tags.join(' and ')}`;
      options.push({
        key: id,
        title: a.title,
        placeName: catPlace.name,
        date: day.date,
        partOfDay: part,
        reason: `${why}, on a free day in ${catPlace.name} (${formatDate(day.date)}). ${a.summary}`,
        timeNote: `${part === 'any' ? 'Most of the day' : part[0]!.toUpperCase() + part.slice(1)}, about ${a.durationHours.min}–${a.durationHours.max} h.${a.schedulingNote ? ` ${a.schedulingNote}` : ''}`,
        budgetNote: 'No price data in the catalogue. The cost stays unknown until you add one.',
        sourceUrl: a.sourceUrls[0]!,
        score,
        commands: [
          {
            type: 'AddClaim',
            claim: {
              id: claimId,
              subjectId: id,
              kind: 'activity_info',
              evidenceStatus: 'source_documented',
              sourceUrl: a.sourceUrls[0]!,
              checkedAt: a.checkedAt,
              dataKind: 'curated',
              dependsOn: { placeId: place.id },
              note: a.summary,
            },
          },
          { type: 'AddActivity', activity },
        ],
      });
    }
  }
  options.sort((x, y) => y.score - x.score || x.key.localeCompare(y.key));
  const unique: typeof options = [];
  const usedDates = new Set<string>();
  for (const o of options) {
    if (usedDates.has(o.date)) continue;
    usedDates.add(o.date);
    unique.push(o);
  }
  if (!unique.length) return [];
  const start = (round * MAX_SURPRISES) % unique.length;
  const rotated = [...unique.slice(start), ...unique.slice(0, start)].slice(0, MAX_SURPRISES);
  return rotated.map(({ score: _score, ...s }) => s);
}
