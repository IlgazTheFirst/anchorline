# Contributing

Thanks for helping. The project runs entirely locally, with no accounts or paid services.

## Setup

```bash
npm ci
npm run dev
npx playwright install chromium   # once, for browser tests
```

Before opening a pull request, run:

```bash
npm run check        # typecheck, lint, unit tests, production build
npm run test:e2e     # browser journeys against the production build
```

CI runs the same steps on every pull request.

## Pull requests

- Keep each PR focused on one change, and explain *why* in the description.
- Add or update tests. Domain rules belong in `tests/domain`, planner behaviour in `tests/planner`, pipeline, storage and import/export in `tests/application`, and user journeys in `tests/e2e`.
- Keep `src/domain` and `src/planner` free of React, Dexie and browser APIs. ESLint enforces this.
- Every change to a trip must go through a typed command (`src/domain/commands.ts`) and the preview/apply pipeline. Never mutate a trip document directly from UI code.
- Do not add a feature that looks like it works but does not: no fake buttons, no success toasts without a state change, no invented prices or departure times.
- **Privacy:** never commit a real person's itinerary, booking references, contact details, screenshots of real trips or credentials. Fixtures must be fictional and say so.

## Add a preference preset

Presets are editable starting points. They set preferences only and can never change dates, locks or commitments.

1. Add an entry to `PRESETS` in `src/domain/presets.ts` with an `id`, a `name`, a one-sentence `description` and a full `profile`. Interest weights run from 0 to 3; pace is `slow`, `balanced` or `fast`.
2. Add a test in `tests/planner` showing that the preset generates a valid plan.
3. Describe in the PR who the preset is for.

## Add a destination pack

A destination pack is a versioned JSON file that the planner can plan within. See [docs/DATA_PACKS.md](docs/DATA_PACKS.md) for the full format.

1. Create `src/catalogue/packs/<pack-id>.json` that validates against `destinationPack` in `src/catalogue/schema.ts`.
2. Write every description yourself. Do not copy guidebooks, reviews or Wikipedia/Wikivoyage text; link them in `sourceUrls` instead.
3. Give every place, activity and route its own `sourceUrls` and `checkedAt`. Routes are planning assumptions with duration **ranges**. Never include timetables, fares or availability.
4. Mark recurring events with `recurrence`. The planner will never put them on a date.
5. Register the pack in `src/catalogue/index.ts`.
6. Run `npm run check:links` to confirm every source resolves, and `npm test` (the pack tests validate structure and connectivity).
7. In the PR, state the licence of the data (project-authored data is MIT) and confirm you have the right to contribute it.

Reviewers check provenance, redistribution rights, stale claims and schema compatibility.

## Fix a bug

Open an issue with steps to reproduce, using the fictional demo or made-up data. A failing test in the PR is the best bug report.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
