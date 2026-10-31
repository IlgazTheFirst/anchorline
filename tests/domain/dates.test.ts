import { describe, expect, it } from 'vitest';
import { elapsedMinutes, hoursBetweenLocalMidnights, nightsBetween, resolveZoned } from '../../src/domain/dates';

describe('dates and time zones', () => {
  it('C06: elapsed time across zones uses instants', () => {
    expect(elapsedMinutes({ localDateTime: '2030-06-23T10:00', timeZone: 'Asia/Singapore' }, { localDateTime: '2030-06-23T11:00', timeZone: 'Asia/Bangkok' })).toBe(120);
  });

  it('A04: 13:00 Hong Kong to 21:00 London on 1 July is 15 hours', () => {
    expect(elapsedMinutes({ localDateTime: '2030-07-01T13:00', timeZone: 'Asia/Hong_Kong' }, { localDateTime: '2030-07-01T21:00', timeZone: 'Europe/London' })).toBe(900);
  });

  it('C07: spring DST date span is one hotel night of 23 hours', () => {
    expect(nightsBetween('2030-03-31', '2030-04-01')).toBe(1);
    expect(hoursBetweenLocalMidnights('2030-03-31', '2030-04-01', 'Europe/London')).toBe(23);
  });

  it('C08: autumn DST date span is one hotel night of 25 hours', () => {
    expect(nightsBetween('2030-10-27', '2030-10-28')).toBe(1);
    expect(hoursBetweenLocalMidnights('2030-10-27', '2030-10-28', 'Europe/London')).toBe(25);
  });

  it('C09: an ambiguous wall-clock time needs explicit disambiguation', () => {
    const r = resolveZoned({ localDateTime: '2030-10-27T01:30', timeZone: 'Europe/London' });
    expect(r.status).toBe('ambiguous');
    if (r.status === 'ambiguous') expect(r.candidates).toEqual(['+01:00', '+00:00']);
    const chosen = resolveZoned({ localDateTime: '2030-10-27T01:30', timeZone: 'Europe/London', offset: '+00:00' });
    expect(chosen.status).toBe('ok');
  });

  it('C10: a nonexistent wall-clock time is rejected, not shifted', () => {
    const r = resolveZoned({ localDateTime: '2030-03-31T01:30', timeZone: 'Europe/London' });
    expect(r.status).toBe('nonexistent');
  });

  it('rejects invalid dates and zones', () => {
    expect(resolveZoned({ localDateTime: '2030-02-30T10:00', timeZone: 'Europe/London' }).status).toBe('invalid');
    expect(resolveZoned({ localDateTime: '2030-02-10T10:00', timeZone: 'Mars/Olympus' }).status).toBe('invalid');
  });
});
