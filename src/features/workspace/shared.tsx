import { useState } from 'react';
import { DEFAULT_PACK } from '../../catalogue';
import type { Place, TripDocument } from '../../domain/schema';
import { Field } from '../../ui/components';
import { catalogueAsPlace, timeZones } from '../setup/options';

/** Choose a catalogue place, an existing custom place, or describe a new custom place. */
export function PlacePicker({ doc, label, value, onChange, excludeHome = true }: { doc: TripDocument; label: string; value: Place | null; onChange: (p: Place | null) => void; excludeHome?: boolean }) {
  const [zones] = useState(timeZones);
  const custom = doc.places.filter((p) => !p.catalogueId && (!excludeHome || p.id !== doc.homePlaceId));
  const [mode, setMode] = useState<'list' | 'custom'>('list');
  const [name, setName] = useState('');
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [tags, setTags] = useState('city');
  const emitCustom = (n: string, z: string, t: string) => {
    if (!n.trim()) return onChange(null);
    const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'place';
    onChange({ id: `custom_${slug}`, name: n.trim(), timeZone: z, tags: t.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8), dataKind: 'user', catalogueId: null, country: null, coordinates: null });
  };
  return (
    <div>
      <Field label={label}>
        {(id) => (
          <select
            id={id}
            value={mode === 'custom' ? '__custom' : (value?.id ?? '')}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom') {
                setMode('custom');
                emitCustom(name, zone, tags);
                return;
              }
              setMode('list');
              if (!v) return onChange(null);
              onChange(catalogueAsPlace(v) ?? doc.places.find((p) => p.id === v) ?? null);
            }}
          >
            <option value="">Choose…</option>
            <optgroup label={DEFAULT_PACK.title}>
              {DEFAULT_PACK.places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {custom.length > 0 && (
              <optgroup label="Your places">
                {custom.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="__custom">Somewhere else (plan by hand)…</option>
          </select>
        )}
      </Field>
      {mode === 'custom' && (
        <div className="row">
          <Field label="Place name">
            {(id) => (
              <input
                id={id}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  emitCustom(e.target.value, zone, tags);
                }}
              />
            )}
          </Field>
          <Field label="Time zone">
            {(id) => (
              <select
                id={id}
                value={zone}
                onChange={(e) => {
                  setZone(e.target.value);
                  emitCustom(name, e.target.value, tags);
                }}
              >
                {zones.map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Tags" hint="(comma-separated, e.g. beach, city)">
            {(id) => (
              <input
                id={id}
                value={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                  emitCustom(name, zone, e.target.value);
                }}
              />
            )}
          </Field>
          <p className="muted">Outside the catalogue there are no automatic routes or suggestions; add travel and activities yourself.</p>
        </div>
      )}
    </div>
  );
}

