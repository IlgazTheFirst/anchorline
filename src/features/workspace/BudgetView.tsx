import { useState } from 'react';
import { newId } from '../../application/newTrip';
import { budgetItemApplicability, scopeOf } from '../../domain/claims';
import { budgetSummaryFor, formatMoney, formatRange, lineTotal, parseMinor, perPersonShare } from '../../domain/money';
import type { BudgetItem } from '../../domain/schema';
import { Badge, Field } from '../../ui/components';
import { CURRENCIES } from '../setup/options';
import type { TripSession } from '../useTripSession';
import { placeName } from './helpers';

const BASIS: Record<BudgetItem['priceBasis'], string> = {
  per_room_night: 'per room per night',
  per_person: 'per person',
  per_person_night: 'per person per night',
  per_booking: 'per booking',
  per_journey: 'per journey',
  per_room: 'per room',
};
const STATUS: Record<BudgetItem['status'], { label: string; kind: 'ok' | 'open' | 'neutral' | 'bad' }> = {
  user_allowance: { label: 'Your allowance', kind: 'neutral' },
  catalogue_estimate: { label: 'Catalogue estimate', kind: 'neutral' },
  synthetic_allowance: { label: 'Fictional allowance', kind: 'open' },
  dated_quote: { label: 'Quote you recorded', kind: 'ok' },
  booked_cost: { label: 'Booked (recorded by you)', kind: 'ok' },
  unknown: { label: 'Price unknown', kind: 'open' },
};

export function BudgetView({ session }: { session: TripSession }) {
  const doc = session.doc!;
  const summary = budgetSummaryFor(doc, (i) => budgetItemApplicability(doc, i).applicable);
  const [label, setLabel] = useState('');
  const [subject, setSubject] = useState('');
  const [currency, setCurrency] = useState(doc.budget.baseCurrency);
  const [amount, setAmount] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [basis, setBasis] = useState<BudgetItem['priceBasis']>('per_booking');
  const [status, setStatus] = useState<BudgetItem['status']>('user_allowance');
  const [fxFrom, setFxFrom] = useState('EUR');
  const [fxRate, setFxRate] = useState('');
  const [error, setError] = useState('');
  const subjects = [
    ...doc.stays.map((s) => ({ id: s.id, label: `Stay: ${placeName(doc, s.placeId)}`, nights: Math.round((Date.parse(s.checkOutExclusive) - Date.parse(s.checkIn)) / 864e5) })),
    ...doc.travelLegs.map((l) => ({ id: l.id, label: `Journey: ${placeName(doc, l.fromPlaceId)} → ${placeName(doc, l.toPlaceId)}`, nights: 0 })),
    ...doc.activities.map((a) => ({ id: a.id, label: `Activity: ${a.title}`, nights: 0 })),
  ];

  const add = () => {
    setError('');
    const digits = currency === 'JPY' ? 0 : 2;
    const min = amount.trim() ? parseMinor(amount, digits) : null;
    const max = amountMax.trim() ? parseMinor(amountMax, digits) : null;
    if (amount.trim() && min === null) return setError('Enter the amount as a number, like 120 or 120.50.');
    if (max !== null && min !== null && max < min) return setError('The upper amount must not be below the lower one.');
    if (!label.trim()) return setError('Give the line a name.');
    const sub = subjects.find((s) => s.id === subject);
    const item: BudgetItem = {
      id: newId('budget'),
      subjectId: subject || null,
      label: label.trim(),
      currency,
      minorUnitDigits: digits,
      unitAmountMinor: min,
      unitAmountMaxMinor: max,
      priceBasis: basis,
      quantity: { rooms: doc.travellers.rooms, people: doc.travellers.count, nights: sub?.nights || undefined, bookings: 1, journeys: 1 },
      status: min === null ? 'unknown' : status,
      dependsOn: subject && (status === 'dated_quote' || status === 'booked_cost') ? (scopeOf(doc, subject) ?? undefined) : undefined,
    };
    session.propose(`Add budget line: ${item.label}`, [{ type: 'AddBudgetItem', item }]);
    setLabel('');
    setAmount('');
    setAmountMax('');
  };

  const base = doc.budget.baseCurrency;
  const target = doc.budget.targetAmountMinor;
  return (
    <div>
      <section className="card" aria-labelledby="budget-h">
        <h2 id="budget-h">Budget coverage</h2>
        {summary.byCurrency.length === 0 && <p>No prices yet.</p>}
        {summary.byCurrency.map((c) => (
          <p key={c.currency} className="num">
            Known in {c.currency}: <strong>{formatRange({ minMinor: c.knownMinMinor, maxMinor: c.knownMaxMinor }, c.currency, c.minorUnitDigits)}</strong> ({c.itemCount} line{c.itemCount === 1 ? '' : 's'})
          </p>
        ))}
        {summary.grandTotal ? (
          <p className="num">
            Trip total: <strong>{formatRange(summary.grandTotal, summary.grandTotal.currency)}</strong>
            {doc.travellers.count > 1 && ` · even share ${formatMoney(perPersonShare(summary.grandTotal.minMinor, doc.travellers.count).shareMinor, summary.grandTotal.currency)} per person (lower figure)`}
          </p>
        ) : (
          <p>
            <Badge kind="open">Incomplete</Badge> No trip total: unknown prices are not counted as zero.
          </p>
        )}
        {target !== null && (
          <p className="muted">
            Your budget: {formatMoney(target, base)} {doc.budget.basis === 'per_person' ? 'per person' : 'for the whole group'}.
          </p>
        )}
        <ul>
          {summary.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h3>Lines</h3>
        {doc.budgetItems.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Price</th>
                  <th scope="col">Total</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {doc.budgetItems.map((b) => {
                  const t = lineTotal(b);
                  const app = budgetItemApplicability(doc, b);
                  return (
                    <tr key={b.id}>
                      <td>
                        {b.label}
                        {!app.applicable && (
                          <div>
                            <Badge kind="bad">No longer applies</Badge> <small>{app.reason}</small>
                          </div>
                        )}
                      </td>
                      <td className="num">{b.unitAmountMinor === null ? 'unknown' : `${formatRange({ minMinor: b.unitAmountMinor, maxMinor: b.unitAmountMaxMinor ?? b.unitAmountMinor }, b.currency, b.minorUnitDigits)} ${BASIS[b.priceBasis]}`}</td>
                      <td className="num">{t ? formatRange(t, b.currency, b.minorUnitDigits) : 'unknown'}</td>
                      <td>
                        <Badge kind={STATUS[b.status].kind}>{STATUS[b.status].label}</Badge>
                      </td>
                      <td>
                        <button type="button" className="link" onClick={() => session.propose(`Remove budget line: ${b.label}`, [{ type: 'RemoveBudgetItem', itemId: b.id }])}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="add-budget-h">
        <h3 id="add-budget-h">Add a line</h3>
        <div className="row">
          <Field label="Name">{(id) => <input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Beach hotel" />}</Field>
          <Field label="For">
            {(id) => (
              <select id={id} value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">The whole trip</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="row">
          <Field label="Amount" hint="(leave empty if unknown)">{(id) => <input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
          <Field label="Up to" hint="(optional range)">{(id) => <input id={id} inputMode="decimal" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />}</Field>
          <Field label="Currency">
            {(id) => (
              <select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="row">
          <Field label="Priced">
            {(id) => (
              <select id={id} value={basis} onChange={(e) => setBasis(e.target.value as BudgetItem['priceBasis'])}>
                {Object.entries(BASIS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="This is">
            {(id) => (
              <select id={id} value={status} onChange={(e) => setStatus(e.target.value as BudgetItem['status'])}>
                <option value="user_allowance">My allowance (a guess)</option>
                <option value="dated_quote">A quote I was given</option>
                <option value="booked_cost">What I paid (booked)</option>
              </select>
            )}
          </Field>
        </div>
        <p className="muted">
          Quantities use {doc.travellers.count} traveller{doc.travellers.count === 1 ? '' : 's'} and {doc.travellers.rooms} room{doc.travellers.rooms === 1 ? '' : 's'}; room prices are not multiplied by travellers.
        </p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="button" className="primary small" onClick={add}>
          Preview budget line
        </button>
      </section>
      <section className="card" aria-labelledby="fx-h">
        <h3 id="fx-h">Exchange rate (your own)</h3>
        <p className="muted">Different currencies are kept separate unless you enter a rate. The app never looks rates up.</p>
        {doc.budget.fx.map((f) => (
          <p key={f.from + f.to}>
            1 {f.from} = {f.rate} {f.to} (as of {f.asOf})
          </p>
        ))}
        <div className="row">
          <Field label="From">
            {(id) => (
              <select id={id} value={fxFrom} onChange={(e) => setFxFrom(e.target.value)}>
                {CURRENCIES.filter((c) => c !== base).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label={`Rate to ${base}`}>{(id) => <input id={id} inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />}</Field>
        </div>
        <button
          type="button"
          className="small"
          disabled={!(Number(fxRate) > 0)}
          onClick={() =>
            session.propose(`Exchange rate ${fxFrom}→${base}`, [
              { type: 'SetFx', fx: [...doc.budget.fx.filter((f) => f.from !== fxFrom), { from: fxFrom, to: base, rate: Number(fxRate), asOf: new Date().toISOString().slice(0, 10), source: 'user_entered' }] },
            ])
          }
        >
          Preview rate
        </button>
      </section>
    </div>
  );
}
