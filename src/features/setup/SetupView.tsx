import { useState, type FormEvent } from 'react';
import { createTrip, defaultNewTripInput, newId, type NewTripInput } from '../../application/newTrip';
import type { TripRepository } from '../../application/repository';
import { DEFAULT_PACK } from '../../catalogue';
import { compareDates, formatDate, formatLocal, isValidLocalDateTime, isValidPlainDate, nightsBetween, Temporal } from '../../domain/dates';
import { PRESETS, presetById } from '../../domain/presets';
import { INTERESTS, type Anchor, type Activity, type Place } from '../../domain/schema';
import { parseMinor } from '../../domain/money';
import { navigate } from '../../ui/navigation';
import { Field, Logo } from '../../ui/components';
import { catalogueAsPlace, CURRENCIES, timeZones } from './options';
import { InterestControls } from '../workspace/PreferencesPanel';

interface EventDraft {
  key: string;
  title: string;
  placeId: string;
  start: string;
  end: string;
  bufferMinutes: number;
}

export function SetupView({ repo }: { repo: TripRepository }) {
  const today = Temporal.Now.plainDateISO().toString();
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  const [input, setInput] = useState<NewTripInput>(() => defaultNewTripInput(today, browserZone));
  const [homeByEnabled, setHomeByEnabled] = useState(true);
  const [homeByDate, setHomeByDate] = useState(input.homeBy!.localDateTime.slice(0, 10));
  const [homeByTime, setHomeByTime] = useState('23:00');
  const [budgetText, setBudgetText] = useState('');
  const [required, setRequired] = useState<Record<string, number>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [beachNights, setBeachNights] = useState(0);
  const [beachDays, setBeachDays] = useState(0);
  const [events, setEvents] = useState<EventDraft[]>([]);
  const [step, setStep] = useState<'form' | 'summary'>('form');
  const [errors, setErrors] = useState<string[]>([]);
  const [zones] = useState(timeZones);
  const set = (patch: Partial<NewTripInput>) => setInput((i) => ({ ...i, ...patch }));
  const nights = isValidPlainDate(input.firstNight) && isValidPlainDate(input.leaveDate) ? nightsBetween(input.firstNight, input.leaveDate) : 0;

  const validate = (): string[] => {
    const e: string[] = [];
    if (!isValidPlainDate(input.departureDate) || !isValidPlainDate(input.firstNight) || !isValidPlainDate(input.leaveDate)) e.push('Enter all three dates.');
    else {
      if (compareDates(input.firstNight, input.departureDate) < 0) e.push('Your first night away cannot be before you leave home.');
      if (compareDates(input.leaveDate, input.firstNight) <= 0) e.push('The day you leave your last stop must be after your first night.');
    }
    if (homeByEnabled && (!isValidPlainDate(homeByDate) || !/^\d{2}:\d{2}$/.test(homeByTime))) e.push('Enter the date and time you need to be home by, or untick it.');
    if (budgetText && parseMinor(budgetText, 2) === null) e.push('The budget must be a number like 2500 or 2500.50.');
    for (const ev of events) {
      if (!ev.title.trim()) e.push('Every fixed event needs a name.');
      if (!isValidLocalDateTime(ev.start) || !isValidLocalDateTime(ev.end)) e.push(`${ev.title || 'An event'}: enter a start and end time.`);
      else if (ev.end <= ev.start) e.push(`${ev.title || 'An event'}: the end must be after the start.`);
    }
    for (const id of Object.keys(required)) if (excluded.has(id)) e.push(`${catalogueAsPlace(id)?.name}: it cannot be both required and avoided.`);
    return e;
  };

  const toSummary = (e: FormEvent) => {
    e.preventDefault();
    const problems = validate();
    setErrors(problems);
    if (!problems.length) setStep('summary');
  };

  const build = () => {
    const doc = createTrip({
      ...input,
      budgetAmountMinor: budgetText ? parseMinor(budgetText, 2) : null,
      homeBy: homeByEnabled ? { localDateTime: `${homeByDate}T${homeByTime}`, bufferMinutes: 60 } : null,
    });
    const places = new Map<string, Place>();
    const anchors: Anchor[] = [];
    const activities: Activity[] = [];
    for (const [id, min] of Object.entries(required)) {
      const p = catalogueAsPlace(id);
      if (!p) continue;
      places.set(id, p);
      anchors.push(min > 0 ? { id: `anchor_min_${id}`, kind: 'minimum_nights_at_place', strength: 'hard', placeId: id, minimumNights: min, label: `At least ${min} nights in ${p.name}` } : { id: `anchor_req_${id}`, kind: 'required_place', strength: 'hard', placeId: id, label: `Visit ${p.name}` });
    }
    for (const id of excluded) {
      const p = catalogueAsPlace(id);
      if (!p) continue;
      places.set(id, p);
      anchors.push({ id: `anchor_avoid_${id}`, kind: 'excluded_place', strength: 'hard', placeId: id, label: `Avoid ${p.name}` });
    }
    if (beachNights > 0) anchors.push({ id: 'anchor_beach_nights', kind: 'minimum_consecutive_nights', strength: 'hard', qualifyingTag: 'beach', minimumNights: beachNights, label: `${beachNights} consecutive beach nights` });
    if (beachDays > 0) anchors.push({ id: 'anchor_beach_days', kind: 'minimum_full_days', strength: 'hard', qualifyingTag: 'beach', minimumDays: beachDays, label: `${beachDays} full beach days` });
    for (const ev of events) {
      const p = catalogueAsPlace(ev.placeId);
      if (!p) continue;
      places.set(p.id, p);
      const actId = newId('event');
      activities.push({ id: actId, placeId: p.id, title: ev.title.trim(), start: { localDateTime: ev.start, timeZone: p.timeZone }, end: { localDateTime: ev.end, timeZone: p.timeZone }, tags: [], lockedFields: ['placeId', 'start', 'end'], dataKind: 'user' });
      anchors.push({ id: `anchor_${actId}`, kind: 'fixed_event', strength: 'hard', activityId: actId, arrivalBufferMinutes: ev.bufferMinutes, label: `Be at ${ev.title.trim()}` });
    }
    doc.places.push(...places.values());
    doc.anchors.push(...anchors);
    doc.activities.push(...activities);
    return doc;
  };

  const create = async (generate: boolean) => {
    try {
      const doc = await repo.create(build());
      navigate(`/trip/${doc.id}${generate ? '?generate=1' : ''}`);
    } catch (err) {
      setErrors([`Could not save the trip: ${(err as Error).message}`]);
    }
  };

  const placeOptions = DEFAULT_PACK.places;
  const gateways = placeOptions.filter((p) => p.gateway !== 'none');

  if (step === 'summary') {
    const preset = presetById(input.profile.presetId);
    return (
      <>
        <Header />
        <main id="main" className="narrow">
          <h1>Check before planning</h1>
          <p className="muted">Correct anything that looks wrong. Hard commitments are never relaxed automatically.</p>
          <section className="card stack" aria-label="Trip summary">
            <p>
              <strong>{input.title || 'My trip'}</strong> from {input.homeName || 'home'} ({input.homeTimeZone})
            </p>
            <p>
              Leave home {formatDate(input.departureDate)}. First night away {formatDate(input.firstNight)}, leave the last stop {formatDate(input.leaveDate)}: <strong>{nights} nights</strong>.
            </p>
            <p>{homeByEnabled ? `Home by ${formatLocal(`${homeByDate}T${homeByTime}`)} (${input.homeTimeZone}), after the final transfer.` : 'No home deadline.'}</p>
            <p>
              {input.travellers} traveller{input.travellers === 1 ? '' : 's'}, {input.rooms} room{input.rooms === 1 ? '' : 's'}. Budget: {budgetText ? `${budgetText} ${input.currency} ${input.budgetBasis === 'per_person' ? 'per person' : 'for the whole group'}` : 'not set'}.
            </p>
            <p>
              Style: {preset.name}, {input.profile.pace} pace. Interests: {INTERESTS.map((i) => `${i} ${input.profile.weights[i]}`).join(', ')}.
              {input.profile.alcoholPreference === 'avoid_alcohol_focused' ? ' No alcohol-focused suggestions.' : ''}
              {input.profile.familyFriendly ? ' Family friendly.' : ''}
              {input.profile.accessibility.stepFreeNeeded ? ' Step-free access needed.' : ''}
            </p>
            <p>Must include: {Object.keys(required).length ? Object.entries(required).map(([id, n]) => `${catalogueAsPlace(id)?.name}${n ? ` (≥${n} nights)` : ''}`).join(', ') : 'nothing specific'}.</p>
            <p>Avoid: {excluded.size ? [...excluded].map((id) => catalogueAsPlace(id)?.name).join(', ') : 'nothing'}.</p>
            <p>
              Beach: {beachNights ? `${beachNights} consecutive nights` : 'no minimum'}
              {beachDays ? `, ${beachDays} full beach days` : ''}.
            </p>
            <p>Fixed events: {events.length ? events.map((e) => `${e.title} (${formatLocal(e.start)} – ${formatLocal(e.end)}, ${catalogueAsPlace(e.placeId)?.name})`).join('; ') : 'none'}.</p>
          </section>
          {errors.length > 0 && (
            <div className="banner warn" role="alert">
              {errors.join(' ')}
            </div>
          )}
          <div className="actions">
            <button type="button" className="primary" onClick={() => create(true)}>
              Create trip and plan it
            </button>
            <button type="button" onClick={() => create(false)}>
              Create an empty trip (plan by hand)
            </button>
            <button type="button" onClick={() => setStep('form')}>
              Back to edit
            </button>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main id="main" className="narrow">
        <h1>Plan a trip</h1>
        <p className="muted">Only the dates are needed to start. Everything can be changed later.</p>
        <form onSubmit={toSummary} noValidate>
          <fieldset>
            <legend>Trip</legend>
            <Field label="Trip name">{(id) => <input id={id} value={input.title} onChange={(e) => set({ title: e.target.value })} placeholder="Spring in the sun" />}</Field>
            <div className="row">
              <Field label="Home city">{(id) => <input id={id} value={input.homeName} onChange={(e) => set({ homeName: e.target.value })} placeholder="Where you start and finish" />}</Field>
              <Field label="Home time zone">
                {(id) => (
                  <select id={id} value={input.homeTimeZone} onChange={(e) => set({ homeTimeZone: e.target.value })}>
                    {zones.map((z) => (
                      <option key={z}>{z}</option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Dates</legend>
            <div className="row">
              <Field label="Leave home">{(id) => <input id={id} type="date" value={input.departureDate} onChange={(e) => set({ departureDate: e.target.value })} />}</Field>
              <Field label="First night away" hint="(local date)">{(id) => <input id={id} type="date" value={input.firstNight} onChange={(e) => set({ firstNight: e.target.value })} />}</Field>
              <Field label="Leave the last stop">{(id) => <input id={id} type="date" value={input.leaveDate} onChange={(e) => set({ leaveDate: e.target.value })} />}</Field>
            </div>
            <p className="muted num">{nights > 0 ? `${nights} nights away.` : 'Pick dates to see the number of nights.'}</p>
            <Field label="I must be home by a set time" inline>
              {(id) => <input id={id} type="checkbox" checked={homeByEnabled} onChange={(e) => setHomeByEnabled(e.target.checked)} />}
            </Field>
            {homeByEnabled && (
              <div className="row">
                <Field label="Home by (date)">{(id) => <input id={id} type="date" value={homeByDate} onChange={(e) => setHomeByDate(e.target.value)} />}</Field>
                <Field label="Home by (time, home zone)">{(id) => <input id={id} type="time" value={homeByTime} onChange={(e) => setHomeByTime(e.target.value)} />}</Field>
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend>Travellers and budget</legend>
            <div className="row">
              <Field label="Travellers">{(id) => <input id={id} type="number" min={1} max={50} value={input.travellers} onChange={(e) => set({ travellers: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
              <Field label="Rooms">{(id) => <input id={id} type="number" min={1} max={50} value={input.rooms} onChange={(e) => set({ rooms: Math.max(1, Number(e.target.value) || 1) })} />}</Field>
              <Field label="Currency">
                {(id) => (
                  <select id={id} value={input.currency} onChange={(e) => set({ currency: e.target.value })}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div className="row">
              <Field label="Budget (optional)">{(id) => <input id={id} inputMode="decimal" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} placeholder="e.g. 3000" />}</Field>
              <Field label="Budget covers">
                {(id) => (
                  <select id={id} value={input.budgetBasis} onChange={(e) => set({ budgetBasis: e.target.value as NewTripInput['budgetBasis'] })}>
                    <option value="whole_group">The whole group</option>
                    <option value="per_person">Each person</option>
                  </select>
                )}
              </Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Travel style</legend>
            <Field label="Starting point" hint="(you can change every setting)">
              {(id) => (
                <select id={id} value={input.profile.presetId} onChange={(e) => set({ profile: structuredClone(presetById(e.target.value).profile) })}>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}: {p.description}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <InterestControls profile={input.profile} onChange={(profile) => set({ profile })} />
          </fieldset>
          <fieldset>
            <legend>Places ({DEFAULT_PACK.title})</legend>
            <p className="muted">Tick places you must include (with a minimum number of nights if you like) or want to avoid. Leave everything unticked to let the planner choose.</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Place</th>
                    <th scope="col">Must include</th>
                    <th scope="col">Min nights</th>
                    <th scope="col">Avoid</th>
                  </tr>
                </thead>
                <tbody>
                  {placeOptions.map((p) => (
                    <tr key={p.id}>
                      <th scope="row" style={{ fontWeight: 500 }}>
                        {p.name} <small className="muted">{p.country}</small>
                      </th>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Must include ${p.name}`}
                          checked={p.id in required}
                          onChange={(e) =>
                            setRequired((r) => {
                              const n = { ...r };
                              if (e.target.checked) n[p.id] = 0;
                              else delete n[p.id];
                              return n;
                            })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          style={{ width: '5rem' }}
                          aria-label={`Minimum nights in ${p.name}`}
                          disabled={!(p.id in required)}
                          value={required[p.id] ?? 0}
                          onChange={(e) => setRequired((r) => ({ ...r, [p.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Avoid ${p.name}`}
                          checked={excluded.has(p.id)}
                          onChange={(e) =>
                            setExcluded((x) => {
                              const n = new Set(x);
                              if (e.target.checked) n.add(p.id);
                              else n.delete(p.id);
                              return n;
                            })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <Field label="Fly into">
                {(id) => (
                  <select id={id} value={input.arrivalGatewayId ?? ''} onChange={(e) => set({ arrivalGatewayId: e.target.value || null })}>
                    <option value="">Whatever suits the route</option>
                    {gateways.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.airports.join('/')})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Fly home from">
                {(id) => (
                  <select id={id} value={input.departureGatewayId ?? ''} onChange={(e) => set({ departureGatewayId: e.target.value || null })}>
                    <option value="">Whatever suits the route</option>
                    {gateways.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.airports.join('/')})
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          </fieldset>
          <fieldset>
            <legend>Beach time</legend>
            <div className="row">
              <Field label="Consecutive beach nights" hint="(0 = no minimum)">
                {(id) => <input id={id} type="number" min={0} max={60} value={beachNights} onChange={(e) => setBeachNights(Math.max(0, Number(e.target.value) || 0))} />}
              </Field>
              <Field label="Full beach days" hint="(no travel that day)">
                {(id) => <input id={id} type="number" min={0} max={60} value={beachDays} onChange={(e) => setBeachDays(Math.max(0, Number(e.target.value) || 0))} />}
              </Field>
            </div>
            <p className="muted">Seven beach nights and seven full beach days are different: arrival, departure and transfer days are not full days.</p>
          </fieldset>
          <fieldset>
            <legend>Fixed events</legend>
            {events.map((ev, i) => (
              <div key={ev.key} className="card" style={{ boxShadow: 'none' }}>
                <div className="row">
                  <Field label="Event">{(id) => <input id={id} value={ev.title} onChange={(e) => setEvents((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />}</Field>
                  <Field label="Place">
                    {(id) => (
                      <select id={id} value={ev.placeId} onChange={(e) => setEvents((list) => list.map((x, j) => (j === i ? { ...x, placeId: e.target.value } : x)))}>
                        {placeOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
                <div className="row">
                  <Field label="Starts (local time there)">{(id) => <input id={id} type="datetime-local" value={ev.start} onChange={(e) => setEvents((list) => list.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />}</Field>
                  <Field label="Ends">{(id) => <input id={id} type="datetime-local" value={ev.end} onChange={(e) => setEvents((list) => list.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />}</Field>
                  <Field label="Arrive this many minutes early">{(id) => <input id={id} type="number" min={0} max={1440} value={ev.bufferMinutes} onChange={(e) => setEvents((list) => list.map((x, j) => (j === i ? { ...x, bufferMinutes: Math.max(0, Number(e.target.value) || 0) } : x)))} />}</Field>
                </div>
                <button type="button" className="small danger" onClick={() => setEvents((list) => list.filter((_, j) => j !== i))}>
                  Remove this event
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setEvents((list) => [...list, { key: newId('ev'), title: '', placeId: placeOptions[0]!.id, start: `${input.firstNight}T19:00`, end: `${input.firstNight}T23:00`, bufferMinutes: 60 }])}>
              Add a fixed event
            </button>
          </fieldset>
          {errors.length > 0 && (
            <div className="banner warn" role="alert">
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="actions">
            <button type="submit" className="primary">
              Review summary
            </button>
            <a className="button" href="#/">
              Cancel
            </a>
          </div>
        </form>
      </main>
    </>
  );
}

function Header() {
  return (
    <header className="app-header">
      <a className="brand" href="#/">
        <Logo /> Holiday Planner
      </a>
    </header>
  );
}
