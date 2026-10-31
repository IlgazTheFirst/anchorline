import { describe, expect, it } from 'vitest';
import { makeProposal, previewProposal } from '../../src/application/proposal';
import { StaleProposalError } from '../../src/application/history';
import { DexieTripRepository, HolidayDatabase } from '../../src/storage/dexieRepository';
import { demoTrip } from '../helpers/fixtures';

let n = 0;
const freshDb = () => new HolidayDatabase(`test-db-${++n}`);

describe('IndexedDB repository (fake-indexeddb)', () => {
  it('A10: undo, reload, redo across repository instances', async () => {
    const db = freshDb();
    const repo = new DexieTripRepository(db);
    let doc = await repo.create(demoTrip());
    for (const title of ['Fictional A', 'Fictional B']) {
      const p = makeProposal(doc, title, [{ type: 'SetTripDetails', title }]);
      doc = (await repo.commit(doc.id, p.baseRevision, previewProposal(doc, p).next!, title)).doc;
    }
    await repo.undo(doc.id, 3);
    db.close();
    const reopened = new DexieTripRepository(new HolidayDatabase(db.name));
    const loaded = (await reopened.get(doc.id))!;
    expect(loaded.doc.title).toBe('Fictional A');
    expect(loaded.history.canRedo).toBe(true);
    const redone = await reopened.redo(doc.id, loaded.doc.revision);
    expect(redone.doc).toMatchObject({ title: 'Fictional B', revision: 5 });
    expect(redone.doc.anchors).toEqual(demoTrip().anchors);
    expect(redone.doc.claims).toEqual(demoTrip().claims);
  });

  it('A09: two tabs — the second, older proposal gets a conflict and nothing is overwritten', async () => {
    const db = freshDb();
    const tabA = new DexieTripRepository(db);
    const tabB = new DexieTripRepository(new HolidayDatabase(db.name));
    const doc = await tabA.create(demoTrip());
    const seenByB = (await tabB.get(doc.id))!.doc;
    const pA = makeProposal(doc, 'A', [{ type: 'SetTripDetails', title: 'Fictional from A' }]);
    await tabA.commit(doc.id, pA.baseRevision, previewProposal(doc, pA).next!, 'A');
    const pB = makeProposal(seenByB, 'B', [{ type: 'SetTripDetails', title: 'Fictional from B' }]);
    await expect(tabB.commit(doc.id, pB.baseRevision, previewProposal(seenByB, pB).next!, 'B')).rejects.toBeInstanceOf(StaleProposalError);
    const final = (await tabA.get(doc.id))!;
    expect(final.doc.title).toBe('Fictional from A');
    expect(final.history.undoLabel).toBe('A');
  });

  it('A09: a failure mid-transaction leaves neither a half-written trip nor half history', async () => {
    const db = freshDb();
    const good = new DexieTripRepository(db);
    const doc = await good.create(demoTrip());
    const failing = new DexieTripRepository(db, {
      afterTripWrite: () => {
        throw new Error('simulated disk failure');
      },
    });
    const p = makeProposal(doc, 'x', [{ type: 'SetTripDetails', title: 'Should not persist' }]);
    await expect(failing.commit(doc.id, 1, previewProposal(doc, p).next!, 'x')).rejects.toThrow('simulated disk failure');
    const after = (await good.get(doc.id))!;
    expect(after.doc.title).toBe(doc.title);
    expect(after.doc.revision).toBe(1);
    expect(after.history.canUndo).toBe(false);
  });
});
