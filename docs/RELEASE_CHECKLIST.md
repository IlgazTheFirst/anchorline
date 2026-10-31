# Release checklist

Open items that are release metadata, not blockers for local use:

- [ ] Choose a dedicated contact for conduct reports (currently: the maintainer via GitHub).
- [x] Name and branding: Anchorline, "Plan around what can't move."
- [ ] Decide whether to host a public demo (for example GitHub Pages). The app is a static build and works offline. Hosting has not been set up.
- [ ] Re-check destination pack sources (`npm run check:links`) and bump the pack `version` and `checkedAt` when content changes.
- [ ] Review the development-only advisory reported by `npm audit` (minimatch via ESLint tooling; not shipped in the browser bundle).

Every release:

- [ ] `npm ci && npm run check && npm run test:e2e` pass locally and in CI.
- [ ] Screenshots regenerated from fictional data (`node scripts/screenshots.mjs` against `npm run preview`).
- [ ] No personal data, booking references or credentials in the tree or the history.
