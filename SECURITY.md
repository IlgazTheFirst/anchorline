# Security policy

## Supported versions

Only the latest commit on `main` is supported while the project is pre-1.0.

## Reporting a vulnerability

Please report security problems privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

You can expect an acknowledgement when the maintainer has seen the report. Please include steps to reproduce and the browser you used.

## Data boundaries

- Trips are stored only in the browser's IndexedDB on the user's device. The app sends no trip data anywhere: no analytics, no uploads, no accounts.
- The only network requests are for the app's own files. Once loaded, the service worker serves the app shell offline.
- Imports are validated before anything is written: size limit (2 MB), JSON syntax, schema version, field shapes, array bounds, dates, references and link schemes. Only `http:` and `https:` links are stored or rendered as links.
- User text (notes, titles, imported content) is always rendered as text, never as HTML, and never becomes a planner command.
- Untrusted change proposals (for example from a future AI integration) go through the same validation. They cannot record bookings, mark evidence as checked or quoted, unlock fields or remove hard commitments.
- A shareable copy is built from an allowlist. Traveller details, booking references, private notes and edit history are never included.
- No provider credentials exist in this repository. Future integrations must keep secrets on a server, never in the browser bundle.
