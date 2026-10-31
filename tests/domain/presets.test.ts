import { describe, expect, it } from 'vitest';
import { PRESETS, presetById } from '../../src/domain/presets';
import { demoTrip, preview } from '../helpers/fixtures';

describe('presets', () => {
  it('ships an editable "A bit of everything" default', () => {
    const p = presetById('a_bit_of_everything');
    expect(p.name).toBe('A bit of everything');
    expect(PRESETS[0]!.id).toBe('a_bit_of_everything');
    expect(p.profile.weights).toMatchObject({ food: 3, city: 2, nightlife: 2, beach: 3, culture: 2, adventure: 1, relax: 2 });
    expect(p.profile.protectRecoveryTime).toBe(true);
    expect(p.profile.pace).toBe('balanced');
  });

  it('can be edited through the normal pipeline without touching commitments', () => {
    const doc = demoTrip();
    const edited = { ...presetById('a_bit_of_everything').profile, weights: { ...presetById('a_bit_of_everything').profile.weights, nightlife: 0, nature: 3 }, alcoholPreference: 'avoid_alcohol_focused' as const };
    const r = preview(doc, [{ type: 'SetPreferences', patch: edited }]);
    expect(r.canApply).toBe(true);
    expect(r.next!.profile.weights.nightlife).toBe(0);
    expect(r.next!.anchors).toEqual(doc.anchors);
    expect(r.next!.stays).toEqual(doc.stays);
    expect(r.next!.activities.find((a) => a.id === 'activity_lantern_night')).toEqual(doc.activities.find((a) => a.id === 'activity_lantern_night'));
  });

  it('every preset sets preferences only', () => {
    for (const p of PRESETS) expect(Object.keys(p.profile).sort()).toEqual(['accessibility', 'alcoholPreference', 'familyFriendly', 'pace', 'presetId', 'protectRecoveryTime', 'weights']);
  });
});
