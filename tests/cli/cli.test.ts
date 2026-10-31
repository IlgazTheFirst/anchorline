import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const BIN = 'skills/anchorline/scripts/anchorline.mjs';
const dir = mkdtempSync(join(tmpdir(), 'anchorline-cli-'));

function run(args: string[], input?: string) {
  const r = spawnSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const PLAN_FLAGS = ['--from', 'Example Town', '--tz', 'Europe/London', '--depart', '2031-02-01', '--nights', '12', '--home-by', '2031-02-14T23:00', '--beach-nights', '4', '--must', 'chiang mai:3'];

describe('anchorline CLI (bundled)', () => {
  it('prints help and version', () => {
    expect(run(['--help']).stdout).toContain('anchorline plan');
    expect(run(['--version']).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('lists catalogue places with coverage notes', () => {
    const out = JSON.parse(run(['places', '--json']).stdout);
    expect(out.places.length).toBeGreaterThanOrEqual(10);
    expect(out.coverage).toMatch(/No timetables, fares or live availability/);
    expect(run(['places']).stdout).toContain('Bangkok [bangkok]');
  });

  it('plans from flags, keeps commitments and labels estimates', () => {
    const r = run(['plan', ...PLAN_FLAGS, '--json']);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('ok');
    expect(out.trip.stays.reduce((n: number, s: { checkIn: string; checkOutExclusive: string }) => n + (Date.parse(s.checkOutExclusive) - Date.parse(s.checkIn)) / 864e5, 0)).toBe(12);
    expect(out.trip.stays.some((s: { placeId: string }) => s.placeId === 'chiang_mai')).toBe(true);
    expect(out.trip.travelLegs.every((l: { departure: unknown }) => l.departure === null)).toBe(true);
    expect(out.honesty).toMatch(/Nothing here is booked/);
    const text = run(['plan', ...PLAN_FLAGS]).stdout;
    expect(text).toContain('planning estimate');
    expect(text).toContain('Nothing here is booked');
  });

  it('plans from a spec on stdin and reports infeasible commitments with exit code 2', () => {
    const spec = { home: { name: 'Example Town', timeZone: 'Europe/London' }, departureDate: '2031-02-01', nights: 5, beachNights: 9 };
    const r = run(['plan', '-', '--json'], JSON.stringify(spec));
    expect(r.code).toBe(2);
    const out = JSON.parse(r.stdout);
    expect(out.status).toBe('infeasible');
    expect(out.conflicts[0].relaxations.length).toBeGreaterThan(0);
  });

  it('rejects an invalid spec with exit code 1', () => {
    const r = run(['plan', '-', '--json'], JSON.stringify({ home: { name: 'X', timeZone: 'Nowhere/Atlantis' }, departureDate: '2031-02-01', nights: 5 }));
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).problems.join(' ')).toMatch(/time zone/);
  });

  it('check, preview, apply and share work on a saved trip; untrusted changes cannot book', () => {
    const trip = join(dir, 'trip.json');
    expect(run(['plan', ...PLAN_FLAGS, '--out', trip]).code).toBe(0);
    const check = JSON.parse(run(['check', trip, '--json']).stdout);
    expect(check.counts.violated).toBe(0);
    expect(check.counts.unresolved).toBeGreaterThan(0);

    const doc = JSON.parse(readFileSync(trip, 'utf8')).document;
    const first = doc.stays[0].id;
    const change = join(dir, 'change.json');
    writeFileSync(change, JSON.stringify({ label: 'One more night', commands: [{ type: 'ResizeStay', stayId: first, nights: doc.stays[0].checkOutExclusive === doc.stays[0].checkIn ? 1 : 2, shiftFollowing: false }] }));
    const before = readFileSync(trip, 'utf8');
    const preview = JSON.parse(run(['preview', trip, change, '--json']).stdout);
    expect(['ready', 'blocked']).toContain(preview.status);
    expect(readFileSync(trip, 'utf8')).toBe(before);

    const booking = join(dir, 'booking.json');
    writeFileSync(booking, JSON.stringify([{ type: 'RecordBooking', mark: { id: 'b1', subjectId: first, status: 'booked', recordedAt: '2030-01-01T00:00:00Z', recordedBy: 'user' } }]));
    const rejected = JSON.parse(run(['preview', trip, booking, '--json']).stdout);
    expect(rejected.status).toBe('rejected');
    expect(rejected.messages.join(' ')).toMatch(/Only you can record/);
    expect(JSON.parse(run(['preview', trip, booking, '--json', '--as-user']).stdout).status).toBe('ready');

    const lock = join(dir, 'lock.json');
    writeFileSync(lock, JSON.stringify({ type: 'LockField', subjectId: first, field: 'dates' }));
    const next = join(dir, 'next.json');
    expect(run(['apply', trip, lock, '--out', next]).code).toBe(0);
    expect(JSON.parse(readFileSync(next, 'utf8')).document.revision).toBe(doc.revision + 1);

    const share = run(['export', trip, '--share', '--omit-dates']).stdout;
    expect(JSON.parse(share).format).toBe('anchorline/shareable');
    expect(share).not.toMatch(/2031-02-\d\d/);
  });

  it('fails clearly on unknown commands and bad files', () => {
    const r = run(['frobnicate']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Unknown command');
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ nope');
    expect(run(['check', bad]).stderr).toContain('not valid JSON');
  });
});
