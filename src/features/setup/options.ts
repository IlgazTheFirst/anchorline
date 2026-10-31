import { DEFAULT_PACK } from '../../catalogue';
import type { Place } from '../../domain/schema';

export const CURRENCIES = ['GBP', 'EUR', 'USD', 'THB', 'MYR', 'SGD', 'AUD', 'CAD', 'JPY', 'TRY', 'CHF'];

export function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['Europe/London', 'Europe/Paris', 'Europe/Istanbul', 'America/New_York', 'Asia/Bangkok', 'Asia/Singapore', 'Australia/Sydney', 'UTC'];
  }
}

export function catalogueAsPlace(id: string): Place | null {
  const p = DEFAULT_PACK.places.find((x) => x.id === id);
  return p ? { id: p.id, name: p.name, timeZone: p.timeZone, tags: p.tags, dataKind: 'curated', catalogueId: p.id, country: p.country, coordinates: null } : null;
}
