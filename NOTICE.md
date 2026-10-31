# Notices and attribution inventory

## Code

Project code and documentation: MIT License, see [LICENSE](LICENSE).

Bundled runtime dependencies (shipped in the browser build):

| Package | Version | Licence | Notes |
|---|---|---|---|
| react, react-dom | 19.3.1 | MIT | |
| zod | 4.6.7 | MIT | |
| dexie | 4.4.7 | Apache-2.0 | Copyright (c) 2014-2017 David Fahlander. Licensed under the Apache License, Version 2.0: http://www.apache.org/licenses/LICENSE-2.0 |
| temporal-polyfill | 1.0.6 | MIT | |

Development-only tools (not shipped): vite, @vitejs/plugin-react, typescript (Apache-2.0), vitest, eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, @playwright/test (Apache-2.0), fake-indexeddb (Apache-2.0), @types/*. Exact versions are pinned in `package-lock.json`.

## Data

| Asset | Origin | Licence |
|---|---|---|
| `src/catalogue/packs/thailand-malay-peninsula.json` | Written for this project. Each record cites its sources (Wikivoyage, Wikipedia) by link, with a check date of 31 October 2026. No text was copied from those sources. | MIT, as project-authored data. The linked pages remain under their own licences (CC BY-SA). |
| `src/fixtures/synthetic-demo-trip.json` | Wholly fictional planning fixture: invented places, event, times and allowances. Real IANA time-zone names only. | MIT |
| Icons and logo (`public/favicon.svg`, inline SVG) | Drawn for this project. | MIT |
| Screenshots in `docs/screenshots/` | Captured from the fictional demo and a generated example trip. | MIT |

No maps, map tiles, geocoding results, photographs, provider responses or third-party reviews are included.
