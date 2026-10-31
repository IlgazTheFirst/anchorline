# Architecture

```text
UI (React)  ──propose(commands)──▶  application/proposal.ts  ──preview──▶  UI shows diff + checks
                                         │ apply (user)
                                         ▼
                              TripRepository.commit(id, baseRevision, next)
                                         │  one IndexedDB read/write transaction:
                                         │  check revision → write document → write history
                                         ▼
                                   storage/dexieRepository.ts
```

## Layers

- **`src/domain`**: the trip document schema (Zod), dates and time zones (Temporal polyfill), money in integer minor units, constraint evaluation, evidence applicability, referential integrity, and the typed command set with its authorisation rules. No React, no storage.
- **`src/planner`**: route graph, scoring, beam search, the night-allocation dynamic programme, explanations, conflicts and surprises. Pure functions over a destination pack and a trip.
- **`src/application`**: proposal preview (validation → staleness → authorisation → apply on a copy → integrity → constraints → diff), pure undo/redo transitions, the repository interface, an in-memory repository, import/export and the allowlisted share builder.
- **`src/storage`**: the Dexie repository. Commit, undo and redo run in a single read/write transaction that compares the current revision to the caller's base revision.
- **`src/features`, `src/ui`**: React screens. They read derived data from the domain and send commands; they never edit the document directly.
- **`src/application/api.ts`, `src/application/tripSpec.ts`**: the operations shared by the terminal and AI front doors (list places, plan from a trip spec, check, preview, share) plus plain-text rendering.
- **`src/cli`, `src/mcp`**: the `anchorline` command and the MCP server (stdio, or stateless streamable HTTP). esbuild bundles both into one file, `skills/anchorline/scripts/anchorline.mjs`, used by npm's `bin`, the Agent Skill and the Claude Code plugin.

## Trip document

One `TripDocument` aggregate with `schemaVersion`, a stable `id` and a monotonically increasing `revision`: places, stays (exclusive check-out), travel legs (zoned times or duration ranges, buffers, evidence ids), activities, anchors (hard or soft commitments), claims (evidence with source, check date and the scope it depended on), budget items, booking marks, profile, traveller details and private notes.

## Key invariants

- **Atomic commits.** A failure inside the transaction leaves neither a half-written document nor half history (tested with an injected failure).
- **Stale proposals fail.** A proposal records its base revision. Committing against a newer revision raises a conflict, and nothing is overwritten. Other tabs hear about commits over `BroadcastChannel` and mark their open previews stale.
- **Undo is a new commit.** Undo and redo produce new, higher revisions. A new edit after undo clears the redo branch.
- **Locks are enforced in commands.** Changing a locked field raises a `locked` error unless the same proposal explicitly unlocks it, and only the user can unlock.
- **Evidence is scoped.** Each claim and quote records the scope it depended on (places, dates, travellers). Applicability is derived by comparing that scope with the current plan, so a city swap or date move makes old evidence inapplicable automatically.
- **Untrusted actors cannot certify.** The `planner` actor may cite curated sources. The `untrusted_proposal` actor may only suggest planning assumptions. Neither can record bookings, quotes or checked timetables, unlock fields, remove hard commitments or edit private data.

## Offline

A small Vite plugin writes `sw.js` at build time, precaching the app shell and every bundled asset. IndexedDB holds the trips. Together they let a production build reload and keep working with no network.

## Extending with providers

Future live data (timetables, quotes) and AI suggestions should enter through the command pipeline as `untrusted_proposal` or a dedicated provider actor. Their outputs cross a Zod validation boundary, and their credentials stay on a server. Nothing in the current build calls a remote service.
