# Destination packs

A destination pack is a versioned JSON file describing one coherent region: places, activities and planning-level routes. The planner only plans automatically inside a pack. Anywhere else, people plan by hand.

The schema is `destinationPack` in `src/catalogue/schema.ts`. Every pack is validated when the app loads and in the test suite.

## Manifest

| Field | Meaning |
|---|---|
| `schemaVersion` | Currently `1` |
| `packId` | Lower-case id, e.g. `th-my-peninsula` |
| `version` | Bump on any content change; plans record the version they came from |
| `title`, `author`, `license`, `attribution` | Shown in the app and in NOTICE.md |
| `dataKind` | `curated` (real, sourced) or `synthetic` (fictional, for tests and demos) |
| `checkedAt` | Date the pack's sources were last checked |
| `coverage` | Short description and the countries covered |
| `sourceUrls` | Pack-level sources |
| `defaultBuffers` | Minutes before and after a journey, by mode keyword (`flight`, `ferry`, `default`) |
| `places`, `activities`, `routes` | See below |
| `events` | Reserved; must be empty in version 1 |

## Places

`id`, `name`, `country`, `timeZone` (IANA), `tags` (for example `beach`, `city`, `island`, `nature`), `scores` (0–3 for `food`, `nightlife`, `beach`, `culture`, `nature`, `adventure`, `city`, `relax`), `familyScore`, `recommendedNights` `{min, ideal, max}`, `gateway` (`major` for long-haul airports, `regional`, or `none`), `airports` (IATA codes), `summary` and `highlights` (your own words), `seasonGuidance` (`wetterMonths`, `cautionMonths`, `note`, or `null`), `sourceUrls`, `checkedAt`, `dataKind`.

Scores are editorial judgements. Keep them consistent within a pack and explain unusual choices in the PR.

## Activities

`id`, `placeId`, `title`, `summary`, `tags` (interest names), `partOfDay` (`morning`, `afternoon`, `evening`, `night`, `any`), `durationHours` `{min, max}`, `intensity` (`easy`, `moderate`, `strenuous`), `distinctive` (0–3), `alcoholCentred`, `familyFriendly`, `stepFree` (`unknown`, `partial`, `not_step_free`, `step_free`), `daysOfWeek` (ISO 1 = Monday … 7 = Sunday, or `null`), `recurrence` (`{kind, note}` for events such as lunar-calendar festivals, or `null`), `schedulingNote`, `sourceUrls`, `checkedAt`, `dataKind`.

Only claim `step_free` when a source says so. `unknown` is honest and makes the gap visible.

## Routes

`id`, `from`, `to` (place ids; routes work in both directions), `mode` (free text, for example `flight`, `ferry`, `flight and road`), `durationMinutes` `{min, max}`, `note`, `sourceUrls`, `checkedAt`, `evidence: "planning_assumption"`.

A route records that a way of travelling between two places is documented, plus a realistic duration range. It is **not** a timetable, a fare or a promise of availability. The app labels it that way everywhere.

## Rules

- Write descriptions yourself. Link sources; do not copy them.
- Keep suggested routes, operating services, timetables, seats, allowances and quotes distinct.
- A recurring event is not a dated occurrence.
- Never include personal itineraries, prices presented as quotes, or credentials.
- Run `npm run check:links` before submitting.
