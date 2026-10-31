import thailandMalayPeninsula from './packs/thailand-malay-peninsula.json';
import { destinationPack, type DestinationPack } from './schema';

/** Bundled packs, validated at load. Add new packs here (see CONTRIBUTING.md). */
export const PACKS: DestinationPack[] = [destinationPack.parse(thailandMalayPeninsula)];

export function getPack(packId: string): DestinationPack | undefined {
  return PACKS.find((p) => p.packId === packId);
}

export const DEFAULT_PACK = PACKS[0]!;

export * from './schema';
