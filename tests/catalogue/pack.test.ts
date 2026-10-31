import { describe, expect, it } from 'vitest';
import { PACKS } from '../../src/catalogue';
import raw from '../../src/catalogue/packs/thailand-malay-peninsula.json';
import { destinationPack } from '../../src/catalogue/schema';

describe('curated destination pack', () => {
  it('validates and is real, curated data separate from the fictional fixture', () => {
    const pack = destinationPack.parse(raw);
    expect(pack.dataKind).toBe('curated');
    expect(pack.places.length).toBeGreaterThanOrEqual(10);
    expect(pack.places.every((p) => p.dataKind === 'curated' && p.sourceUrls.length > 0 && p.checkedAt === '2026-10-31')).toBe(true);
    expect(pack.activities.every((a) => a.sourceUrls.length > 0)).toBe(true);
    expect(pack.routes.every((r) => r.evidence === 'planning_assumption')).toBe(true);
  });

  it('connects every place to the route graph', () => {
    const pack = PACKS[0]!;
    for (const p of pack.places) expect(pack.routes.some((r) => r.from === p.id || r.to === p.id), p.id).toBe(true);
  });

  it('contains no prices or timetables', () => {
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/"(price|fare|amount|departs|timetable)"\s*:/i);
  });
});
