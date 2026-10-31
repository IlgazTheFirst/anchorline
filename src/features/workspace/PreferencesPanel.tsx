import { useState } from 'react';
import { PRESETS, presetById } from '../../domain/presets';
import { INTERESTS, type Profile } from '../../domain/schema';
import { Field } from '../../ui/components';
import type { TripSession } from '../useTripSession';

const LABELS: Record<(typeof INTERESTS)[number], string> = {
  food: 'Food',
  nightlife: 'Evenings out',
  beach: 'Beaches',
  culture: 'Culture',
  nature: 'Nature',
  adventure: 'Adventure',
  city: 'City life',
  relax: 'Downtime',
};
const LEVELS = ['not for me', 'a little', 'yes', 'a priority'];

export function InterestControls({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  return (
    <>
      <div className="row">
        {INTERESTS.map((i) => (
          <Field key={i} label={LABELS[i]} hint={`(${LEVELS[profile.weights[i]] ?? profile.weights[i]})`}>
            {(id) => (
              <input
                id={id}
                type="range"
                min={0}
                max={3}
                step={1}
                value={profile.weights[i]}
                aria-valuetext={LEVELS[profile.weights[i]]}
                onChange={(e) => onChange({ ...profile, weights: { ...profile.weights, [i]: Number(e.target.value) } })}
              />
            )}
          </Field>
        ))}
      </div>
      <fieldset style={{ border: 'none', padding: 0 }}>
        <legend className="field">Pace</legend>
        <div className="row">
          {(['slow', 'balanced', 'fast'] as const).map((p) => (
            <label key={p} className="field inline">
              <input type="radio" name="pace" value={p} checked={profile.pace === p} onChange={() => onChange({ ...profile, pace: p })} />
              {p === 'slow' ? 'Slow (longer stays)' : p === 'balanced' ? 'Balanced' : 'Fast (more stops)'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row">
        <Field label="Quiet evenings: no alcohol-focused suggestions" inline>
          {(id) => <input id={id} type="checkbox" checked={profile.alcoholPreference === 'avoid_alcohol_focused'} onChange={(e) => onChange({ ...profile, alcoholPreference: e.target.checked ? 'avoid_alcohol_focused' : 'unspecified' })} />}
        </Field>
        <Field label="Travelling with children" inline>
          {(id) => <input id={id} type="checkbox" checked={profile.familyFriendly} onChange={(e) => onChange({ ...profile, familyFriendly: e.target.checked })} />}
        </Field>
        <Field label="Step-free access needed" inline>
          {(id) => <input id={id} type="checkbox" checked={profile.accessibility.stepFreeNeeded} onChange={(e) => onChange({ ...profile, accessibility: { ...profile.accessibility, stepFreeNeeded: e.target.checked } })} />}
        </Field>
      </div>
    </>
  );
}

export function PreferencesPanel({ session }: { session: TripSession }) {
  const doc = session.doc!;
  const [draft, setDraft] = useState<Profile>(doc.profile);
  const [open, setOpen] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(doc.profile);
  return (
    <section className="card" aria-labelledby="prefs-h">
      <h2 id="prefs-h">Preferences</h2>
      <p className="muted">{presetById(doc.profile.presetId).name}, {doc.profile.pace} pace.</p>
      <button type="button" className="small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide preferences' : 'Change preferences'}
      </button>
      {open && (
        <div style={{ marginTop: '0.75rem' }}>
          <Field label="Start from a preset">
            {(id) => (
              <select id={id} value={draft.presetId} onChange={(e) => setDraft(structuredClone(presetById(e.target.value).profile))}>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <InterestControls profile={draft} onChange={setDraft} />
          <button type="button" className="primary small" disabled={!changed} onClick={() => session.propose('Change preferences', [{ type: 'SetPreferences', patch: draft }])}>
            Preview preference change
          </button>
          <p className="muted">Preferences shape suggestions and new plans. They never move locked dates or commitments.</p>
        </div>
      )}
    </section>
  );
}
