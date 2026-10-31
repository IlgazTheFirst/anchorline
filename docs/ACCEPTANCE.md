# Acceptance cases and where they are tested

The release gate is a set of acceptance scenarios (A01–A17) and reference constraint cases (C01–C20). Each one is automated as follows.

## Constraint cases (Vitest)

| Case | What | Test |
|---|---|---|
| C01 | 20 hotel nights, 7-night beach block, 5 full days in the main block | `tests/domain/nights.test.ts` |
| C02 | Shortening the beach block is violated and cannot apply | `tests/domain/constraints.test.ts` |
| C03 | Replacing a city invalidates its route evidence; the route becomes unresolved | `tests/application/pipeline.test.ts` |
| C04 | Arrival on 2 July breaks the 1 July deadline | `tests/domain/constraints.test.ts` |
| C05 | A post-arrival transfer pushes "ready" past the deadline | `tests/domain/constraints.test.ts` |
| C06 | 10:00 Singapore → 11:00 Bangkok is 120 minutes | `tests/domain/dates.test.ts` |
| C07, C08 | Clock-change dates are one hotel night (23 h / 25 h) | `tests/domain/dates.test.ts` |
| C09, C10 | Ambiguous times need an offset; nonexistent times are rejected | `tests/domain/dates.test.ts` |
| C11 | Unknown prices stay unknown; no grand total | `tests/domain/money.test.ts` |
| C12 | No mixed-currency total without a rate | `tests/domain/money.test.ts` |
| C13 | Room price × rooms × nights, not × people | `tests/domain/money.test.ts` |
| C14 | Stale proposals are refused, document unchanged | `tests/application/pipeline.test.ts` |
| C15 | Untrusted proposals cannot mark live quotes or bookings | `tests/application/pipeline.test.ts` |
| C16 | Two locked events in two places at once stay visible as a conflict | `tests/domain/constraints.test.ts` |
| C17 | Different inputs give different valid plans in the real pack | `tests/planner/planner.test.ts` |
| C18 | Leaving at midnight during a cross-midnight event is violated | `tests/domain/constraints.test.ts` |
| C19 | Undo creates a new revision; old proposals stay stale | `tests/application/pipeline.test.ts` |
| C20 | A leg with no times or duration is unresolved, never feasible | `tests/domain/constraints.test.ts` |

## Acceptance scenarios

| Case | Domain test (Vitest) | Browser journey (Playwright) |
|---|---|---|
| Core flow: create → edit a stay → preview → apply → save → reload → undo | `pipeline.test.ts`, `storage.test.ts` | `core-flow.spec.ts` (desktop 1440×900 and mobile 390×844, screenshots in `docs/demo/`), `journey.spec.ts` |
| Manual custom places | `custom-places.test.ts`, `planner.test.ts` | `custom-place.spec.ts` |
| Editable "A bit of everything" preset | `presets.test.ts` | |
| Surprises without overcrowding or displacing rest | `planner.test.ts` | |
| A01 Correct nights | `nights.test.ts` | `journey.spec.ts` (night counts in the UI) |
| A02 Cross-midnight event | `constraints.test.ts` (C18) | |
| A03 Home arrival deadline | `constraints.test.ts` (C04) | |
| A04 Time zones and DST | `dates.test.ts` | |
| A05 Anchors before preferences | `constraints.test.ts`, `pipeline.test.ts`, `planner.test.ts` (events, surprises) | `journey.spec.ts` (blocked change) |
| A06 New inputs, not a canned demo | `planner.test.ts` | `journey.spec.ts` (create and generate) |
| A07 Incomplete draft | `pipeline.test.ts` | |
| A08 Replace a city | `pipeline.test.ts` | |
| A09 Atomic commit, competing tabs | `storage.test.ts` (fake IndexedDB, injected failure) | `conflict.spec.ts` |
| A10 Persistent undo/redo | `pipeline.test.ts`, `storage.test.ts` | `journey.spec.ts` (reload between undo and redo) |
| A11 Evidence is not self-certified | `pipeline.test.ts`, `planner.test.ts` | |
| A12 Budget arithmetic | `money.test.ts` | |
| A13 Safe import/export | `transfer.test.ts` | `import-export.spec.ts` |
| A14 Untrusted source content | `transfer.test.ts` | `import-export.spec.ts` (script text shown as text) |
| A15 Offline production journey | | `offline.spec.ts` |
| A16 Mobile and keyboard completion | | `mobile-keyboard.spec.ts` |
| A17 Deliberate shareable export | `transfer.test.ts` | `import-export.spec.ts` |
