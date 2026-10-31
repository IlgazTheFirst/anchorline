import { makeProposal, previewProposal } from '../../src/application/proposal';
import type { Actor, Command } from '../../src/domain/commands';
import type { TripDocument } from '../../src/domain/schema';
import { demoTrip } from '../../src/fixtures';

export { demoTrip };

export function preview(doc: TripDocument, commands: Command[], actor: Actor = 'user') {
  return previewProposal(doc, makeProposal(doc, 'test change', commands, actor));
}

export function result(r: ReturnType<typeof preview>, id: string) {
  return r.after.find((x) => x.id === id || x.anchorId === id);
}
