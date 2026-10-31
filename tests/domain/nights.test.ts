import { describe, expect, it } from 'vitest';
import { dayCards, fullDaysAtTag, fullDaysInBlock, longestBlock, qualifyingBlocks, totalHotelNights } from '../../src/domain/derive';
import { demoTrip } from '../helpers/fixtures';

describe('A01 / C01: nights and usable days', () => {
  const doc = demoTrip();

  it('counts 20 hotel nights from 11 June to 1 July', () => {
    expect(totalHotelNights(doc)).toBe(20);
  });

  it('joins adjacent beach stays into one seven-night block', () => {
    const block = longestBlock(qualifyingBlocks(doc, 'beach'));
    expect(block).toMatchObject({ start: '2030-06-23', endExclusive: '2030-06-30', nights: 7 });
  });

  it('counts full beach days without arrival, departure or transfer days', () => {
    const main = longestBlock(qualifyingBlocks(doc, 'beach'))!;
    expect(fullDaysInBlock(doc, main)).toEqual(['2030-06-24', '2030-06-25', '2030-06-26', '2030-06-28', '2030-06-29']);
    // Lantern Bay is also a beach base, so the whole trip has three more full beach days.
    expect(fullDaysAtTag(doc, 'beach')).toEqual(['2030-06-12', '2030-06-13', '2030-06-14', '2030-06-24', '2030-06-25', '2030-06-26', '2030-06-28', '2030-06-29']);
  });

  it('marks departure and transfer dates as not full days', () => {
    const cards = dayCards(doc);
    const byDate = new Map(cards.map((c) => [c.date, c]));
    expect(byDate.get('2030-06-27')?.isFullDay).toBe(false);
    expect(byDate.get('2030-06-27')?.isTransferDay).toBe(true);
    expect(byDate.get('2030-06-10')?.isFullDay).toBe(false);
    expect(byDate.get('2030-06-25')?.isFullDay).toBe(true);
  });
});
