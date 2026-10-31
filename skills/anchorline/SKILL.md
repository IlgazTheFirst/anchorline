---
name: anchorline
description: Plans holidays around fixed commitments with the Anchorline planner (fixed dates and events, minimum nights in a place, consecutive beach nights, must-visit or avoided places, a home-by deadline), checks an itinerary against those commitments, and previews a change before it is made. Use when someone asks for a day-by-day trip plan with constraints, asks whether a plan still works after a change, or wants a shareable copy without private details. Automatic routes cover Thailand, Malaysia and Singapore; anywhere else can be planned by hand. Works offline. It never books, never quotes fares and never invents timetables.
license: MIT
compatibility: Requires Node.js 20 or newer to run scripts/anchorline.mjs. No network access or API keys needed.
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/anchorline.mjs *)
---

# Anchorline

Anchorline is a deterministic, offline holiday planner: it builds one recommended itinerary from dates, interests and commitments, explains it, and shows exactly what a change would do before anything changes. Everything runs through one bundled script.

```bash
A="node ${CLAUDE_SKILL_DIR}/scripts/anchorline.mjs"   # outside Claude Code: this skill's scripts/anchorline.mjs
```

If the Anchorline MCP tools are connected (`plan_trip`, `check_trip`, `preview_change`, `share_export`, `list_places`), you can use them instead. They behave the same.

## When to use it

- A trip with things that cannot move: event dates, "at least 4 nights in Chiang Mai", "7 nights on the beach in a row", "home by Sunday 23:00".
- Checking an existing Anchorline trip, or the effect of a proposed edit, before committing to it.
- Not for: booking, live prices, flight times, visas or anything outside travel planning. Say so and offer what Anchorline can do.

## Workflow

1. **Gather only what is missing.** Required: home city and its IANA time zone, departure date, and either nights away or the day they leave the last stop. Useful: home-by deadline, travellers, must-visit places with minimum nights, places to avoid, beach nights, fixed events, travel style. Don't ask about anything you can default.
2. **See what is covered** when places are in question: `$A places` (add `--json` for structure). Places outside the list go in `ownPlaces` with dates; they get no routes or activities.
3. **Plan.** Write a spec (format below) to a temp file and run:
   ```bash
   $A plan /tmp/anchorline-spec.json --out /tmp/anchorline-trip.json
   ```
   Or use flags: `$A plan --from London --tz Europe/London --depart 2031-02-01 --nights 14 --home-by 2031-02-16T23:00 --must "chiang mai:3" --beach-nights 5 --out /tmp/anchorline-trip.json`.
   Exit code 2 means the commitments conflict. Show the conflicts and their suggested relaxations, and let the person choose. Never relax one yourself.
4. **Present** the result (see "Presenting results").
5. **Change something** by previewing first:
   ```bash
   $A preview /tmp/anchorline-trip.json /tmp/change.json        # nothing is written
   $A apply   /tmp/anchorline-trip.json /tmp/change.json --out /tmp/anchorline-trip-2.json
   ```
   A change file is one command, an array, or `{"label": "...", "commands": [...]}`. Command formats are in [references/commands.md](references/commands.md). Get stay and leg ids from the trip JSON (`$A plan ... --json` or the saved file). If the preview says **blocked**, explain which commitment it breaks and offer the listed relaxations.
6. **Check** any trip: `$A check /tmp/anchorline-trip.json` (add `--strict` to exit 2 on a broken commitment).
7. **Share** without private details: `$A export /tmp/anchorline-trip.json --share [--omit-dates] [--omit-costs]`.

The saved trip file is an Anchorline private backup. The person can import it into the browser app.

## Trip spec

```json
{
  "title": "Spring in the sun",
  "home": { "name": "London", "timeZone": "Europe/London" },
  "departureDate": "2031-02-01",
  "nights": 14,
  "homeBy": "2031-02-16T23:00",
  "travellers": 2,
  "preset": "a_bit_of_everything",
  "interests": { "beach": 3, "nightlife": 1 },
  "mustVisit": [{ "place": "Chiang Mai", "minNights": 3 }],
  "avoid": ["Phuket"],
  "beachNights": 5,
  "events": [{ "title": "Friend's wedding", "place": "Krabi", "start": "2031-02-08T16:00", "end": "2031-02-08T23:30", "arriveEarlyMinutes": 120 }],
  "ownPlaces": [{ "name": "A friend's house", "timeZone": "Asia/Bangkok", "checkIn": "2031-02-02", "nights": 2 }]
}
```

- Dates are `YYYY-MM-DD`; times are local `YYYY-MM-DDTHH:MM` (event times at the event's place, `homeBy` at home).
- `leaveDate` can replace `nights`; `firstNight` defaults to the day after departure.
- Presets: `a_bit_of_everything` (default: food, cities and culture, social evenings, proper beach time, a little adventure, enough downtime), `quiet_evenings`, `slow_and_easy`, `family`, `adventure`. Interest weights are 0–3. Also `pace` (`slow`, `balanced`, `fast`), `quietEvenings`, `family`, `stepFree`, `arriveVia`, `leaveFrom`.
- Places accept ids or names from `places`.

## Presenting results

Lead with the plan: stays with dates and nights, then the day-by-day outline, then **why** (the listed reasons), then **still to check**. Keep it tight. Then hold to these rules:

- **Planning estimates are estimates.** Journey durations are ranges from documented routes. Call them "about 1–1.5 h (planning estimate)". Never present a time, timetable, operator or fare as fact. Long-haul flights have no times until the person adds them.
- **Sourced facts keep their source.** Place and activity details come with links in the trip's `claims`. Cite them when it helps.
- **Nothing is booked, priced or confirmed.** Never say "booked", "available", "confirmed" or give a price unless the person recorded it themselves. An unknown cost is unknown, not zero.
- **Unresolved is not fine.** Checks marked unresolved (for example, the home deadline before return times are known) stay open questions. List them; don't paper over them.
- **Recurring events** such as monthly full-moon parties are never scheduled. Tell the person to check the date.
- **Commitments win.** If a request conflicts with a fixed commitment, say which one, show the relaxations, and ask.
- **Suggestions are suggestions.** Changes you propose are untrusted by default: the tool refuses bookings, quotes, checked timetables, unlocking and removing hard commitments. Use `--as-user` only when the person explicitly asks for it and has the information themselves (for example, recording a booking they made).
