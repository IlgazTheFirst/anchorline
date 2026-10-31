import type { Profile } from './schema';

export interface Preset {
  id: string;
  name: string;
  description: string;
  profile: Profile;
}

const base = {
  protectRecoveryTime: true,
  alcoholPreference: 'unspecified' as const,
  familyFriendly: false,
  accessibility: { stepFreeNeeded: false },
};

/**
 * Editable starting points. A preset only sets preferences; it never changes
 * dates, locks or other commitments. Add new ones here (see CONTRIBUTING.md).
 */
export const PRESETS: Preset[] = [
  {
    id: 'a_bit_of_everything',
    name: 'A bit of everything',
    description: 'Good food, lively evenings, city exploring, real beach time, a little adventure and room to rest.',
    profile: { presetId: 'a_bit_of_everything', weights: { food: 3, nightlife: 2, beach: 2, culture: 2, nature: 2, adventure: 2, city: 2, relax: 2 }, pace: 'balanced', ...base },
  },
  {
    id: 'quiet_evenings',
    name: 'Quiet evenings',
    description: 'Culture, nature and food by day; calm nights without party-focused suggestions.',
    profile: { presetId: 'quiet_evenings', weights: { food: 3, nightlife: 0, beach: 2, culture: 3, nature: 3, adventure: 1, city: 1, relax: 3 }, pace: 'balanced', ...base, alcoholPreference: 'avoid_alcohol_focused' },
  },
  {
    id: 'slow_and_easy',
    name: 'Slow and easy',
    description: 'Fewer moves, longer stays, more beach and downtime.',
    profile: { presetId: 'slow_and_easy', weights: { food: 2, nightlife: 1, beach: 3, culture: 1, nature: 2, adventure: 0, city: 1, relax: 3 }, pace: 'slow', ...base },
  },
  {
    id: 'family',
    name: 'Family friendly',
    description: 'Places and activities that suit children, with gentle travel days.',
    profile: { presetId: 'family', weights: { food: 2, nightlife: 0, beach: 3, culture: 2, nature: 3, adventure: 1, city: 1, relax: 2 }, pace: 'slow', ...base, familyFriendly: true, alcoholPreference: 'avoid_alcohol_focused' },
  },
  {
    id: 'adventure',
    name: 'Active and outdoors',
    description: 'Hikes, climbing, diving and wild places, with cities as short stops.',
    profile: { presetId: 'adventure', weights: { food: 2, nightlife: 1, beach: 2, culture: 1, nature: 3, adventure: 3, city: 1, relax: 1 }, pace: 'fast', ...base },
  },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}
