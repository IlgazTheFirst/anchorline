import { budgetItemApplicability } from '../../domain/claims';
import type { ConstraintResult } from '../../domain/constraints';
import { formatDate, formatMinutes, formatZoned } from '../../domain/dates';
import { dayCards, sortStays, stayNights, totalHotelNights } from '../../domain/derive';
import { budgetSummaryFor, formatRange } from '../../domain/money';
import type { TripDocument } from '../../domain/schema';
import { placeName } from './helpers';

/** Print-only, plain itinerary. Hidden on screen; shown by the print stylesheet. */
export function PrintItinerary({ doc, results }: { doc: TripDocument; results: ConstraintResult[] }) {
  const budget = budgetSummaryFor(doc, (i) => budgetItemApplicability(doc, i).applicable);
  const open = results.filter((r) => r.status !== 'satisfied');
  return (
    <article className="print-only" aria-hidden="true">
      <h1>{doc.title}</h1>
      {doc.isSynthetic && <p>Fictional demo: every place, event, time and price is invented.</p>}
      <p>
        {totalHotelNights(doc)} nights · {doc.travellers.count} traveller(s). This is a plan, not a booking, unless marked as booked by you.
      </p>
      <h2>Stays</h2>
      <ol>
        {sortStays(doc.stays).map((s) => (
          <li key={s.id}>
            {placeName(doc, s.placeId)}: {formatDate(s.checkIn)} → {formatDate(s.checkOutExclusive)} ({stayNights(s)} nights){s.accommodation?.name ? ` · ${s.accommodation.name}` : ''}
          </li>
        ))}
      </ol>
      <h2>Journeys</h2>
      <ul>
        {doc.travelLegs.map((l) => (
          <li key={l.id}>
            {placeName(doc, l.fromPlaceId)} → {placeName(doc, l.toPlaceId)}: {l.mode}. {l.departure ? `Departs ${formatZoned(l.departure)}.` : 'Time not set.'} {l.arrival ? `Arrives ${formatZoned(l.arrival)}.` : ''}{' '}
            {l.durationRangeMinutes ? `Estimate ${formatMinutes(l.durationRangeMinutes.min)}–${formatMinutes(l.durationRangeMinutes.max)}.` : ''}
          </li>
        ))}
      </ul>
      <h2>Day by day</h2>
      {dayCards(doc).map((c) => (
        <div key={c.date}>
          <h3>
            {formatDate(c.date)}: {c.placeIds.map((p) => placeName(doc, p)).join(' → ') || 'travelling'}
          </h3>
          <ul>
            {c.activities.map((a) => (
              <li key={a.id}>
                {a.partOfDay ?? 'any time'}: {a.title}
              </li>
            ))}
            {c.isFullDay && c.freeParts.length > 0 && <li>Free: {c.freeParts.join(', ')}</li>}
          </ul>
        </div>
      ))}
      <h2>Budget coverage</h2>
      {budget.byCurrency.map((c) => (
        <p key={c.currency}>
          Known {c.currency}: {formatRange({ minMinor: c.knownMinMinor, maxMinor: c.knownMaxMinor }, c.currency, c.minorUnitDigits)}
        </p>
      ))}
      <p>{budget.grandTotal ? `Total: ${formatRange(budget.grandTotal, budget.grandTotal.currency)}` : 'No trip total: some prices are unknown or in other currencies.'}</p>
      {open.length > 0 && (
        <>
          <h2>Still to check</h2>
          <ul>
            {open.map((r) => (
              <li key={r.id}>
                {r.label}: {r.explanation}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
