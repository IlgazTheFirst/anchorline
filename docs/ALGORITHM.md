# How the planner thinks

The planner turns dates, commitments and preferences into **one** recommended route, with its reasons and its open questions. It is deterministic: the same inputs and the same destination-pack version always give the same plan. There is no randomness, no language model and no network call.

Code: `src/planner/` (pure TypeScript; it never imports React or storage).

## 1. Inputs

`buildPlanRequest()` (`src/planner/fromTrip.ts`) converts the trip's own data into planner inputs. Nothing is relaxed here.

| Trip data | Becomes |
|---|---|
| First night and the day you leave the last stop | `N` nights to fill exactly |
| Must-visit place, minimum nights in a place | required stop and a per-stop minimum |
| Avoided place | excluded candidate |
| Consecutive beach nights | a run constraint on `beach`-tagged stops |
| Full beach days | a count of interior days at `beach` stops |
| Fixed event | a **pin**: the event's place must hold the nights from the day before the event (when the trip allows) through the night the event ends, so you arrive in good time and do not travel straight after |
| Protected rest | a pin over the rest interval |
| Locked stay dates | an **exact** pin: same place, same check-in and check-out |
| A stay at one of your own places (outside the catalogue) | an exact pin too: the planner knows nothing about it, so it keeps the stay where you put it and plans around it |
| Locked journey times, locked activities | carried into the new plan unchanged |
| Home deadline | checked against the day you leave; a deadline before it is a conflict |
| Profile | interest weights (0–3), pace, quiet evenings, family, step-free |

## 2. Early conflict checks

Before searching, `basicConflicts()` looks for contradictions that no route can fix: dates in the wrong order, more than 90 nights, a home deadline before the trip ends, a commitment outside the trip, two commitments needing different places on the same night, and a place that is both required and avoided. Each conflict comes with concrete relaxations ("Leave the last stop by …", "Move or drop …"). The planner never applies a relaxation itself.

## 3. Candidate stops and night bounds

Every catalogue place that is not excluded is a candidate. For each one:

- **value** (`placeValue`, `src/planner/score.ts`) is the weighted match between the place's 0–3 interest scores and your 0–3 weights, normalised to 0–1. Quiet evenings caps the nightlife weight. Travelling with children adds a small bonus for family-friendly places. If the trip's middle month is in a place's usually wetter months, value drops by 0.15; a caution month (for example smoke haze) drops it by 0.2. The season data is approximate guidance and is labelled as such.
- **lower bound**: the place's recommended minimum, raised to the pace minimum (slow 3, balanced 2, fast 1 nights), any minimum you set, and the length of any pin.
- **upper bound**: the place's recommended maximum, plus 2 (slow) or 1 (balanced) extra nights, plus 3 for beach places when a consecutive-beach requirement exists. Exact pins fix both bounds.

Custom places outside the catalogue can take part when they are pinned or required; they get a neutral value and unknown transfers.

## 4. Route search (beam search)

Place orders are built one stop at a time:

- A step is allowed only if the route graph connects the two places. The graph (`src/planner/graph.ts`) holds the pack's documented connections; all-pairs best transfers are computed with Floyd–Warshall on typical minutes (midpoint of each range, plus 120 minutes per extra hop), so "Phuket → Chiang Mai via Bangkok" is possible when no direct option is listed.
- Pinned places must appear in the order of their dates.
- A partial order is pruned if the required places still missing cannot fit in the remaining stops.
- Each partial order gets a quick score (ideal nights at each stop, minus penalties, plus variety) and only the best 160 survive each depth. Partial orders that already contain required places rank first (+10 per required place), because every final route must contain them; this never changes how complete routes compare. Ties break on the place ids, so the search is stable.
- Up to 48 complete orders per depth (those containing every required place) go on to exact night allocation.

The number of stops runs from the number of required places up to 8, also limited by the nights available.

## 5. Exact night allocation (dynamic programming)

`allocateNights()` (`src/planner/allocate.ts`) finds the best split of exactly `N` nights for a given order. The state is (stop index, nights used, progress on each consecutive-night run, progress on each full-day count). A transition gives stop *i* any night count within its bounds, if:

- the remaining stops can still fill the remaining nights;
- every pin is covered (exact pins must match exactly);
- run and full-day progress update correctly. A run grows across adjacent qualifying stops and resets at a non-qualifying stop. Full days at a stop are `nights − 1`, because the arrival and departure days are transfer days.

The value of a stop is **diminishing**: the *n*th night is worth `0.85^(n−1)` of the first. So extra nights go where they add the most, rather than all to the single best place. The allocation with the highest total value that meets every minimum wins. If none exists, the order is rejected.

## 6. Final score

```
score = Σ night utility + variety − moves − transfers − gateways
```

- **variety**: for each interest you rated 2 or more, `0.35 × (best score for it on the route ÷ 3) × (weight ÷ 3)`. This is what makes "a bit of everything" mix cities, beaches and nature instead of picking three beaches.
- **moves**: each change of accommodation costs 1.2 (slow), 0.7 (balanced) or 0.35 (fast).
- **transfers**: 0.08 per typical hour of travel between stops, plus 0.2 per extra hop.
- **gateways**: the cost of reaching the first stop from the nearest major airport (or the one you chose), and of getting back from the last.

Constants live in `PACE` and `WEIGHTS` in `src/planner/score.ts`, so they are easy to tune and review.

The best plan is returned with up to three alternatives (mirror-image routes are skipped), each with its score difference, so you can preview one instead.

## 7. Activities

For each stop, interior days (not arrival, departure, fixed-event or rest days) get suggestions. Slow pace gives about one activity every two days, balanced three every four days, fast five every four days. Each activity goes to the least busy valid day, so plans spread out instead of front-loading. A day holds either one full-day outing or at most two part-day activities, so at least one part of every day stays free. With **Keep the morning after a late night free** (on in "A bit of everything"), nothing is planned the morning after a night-time activity, or after a timed event that ends at 22:00 or later or crosses midnight.

Catalogue activities are ranked by the match with your interests plus how distinctive they are. Filters: no alcohol-focused activities with quiet evenings, only family-friendly ones with children, nothing marked not step-free when you need step-free access, nothing strenuous at a slow pace. Day-of-week schedules are respected; if a highly distinctive activity only runs on a day you are not there, the plan says so. Recurring events (for example lunar-calendar parties) are **never** placed on a date. The plan tells you to check the date yourself.

## 8. Output: honest by construction

- Stays carry a short reason: interests matched, requirements served, comfortable length, season note.
- Journeys between stops get the documented mode and a duration **range**, marked as a planning estimate. Departure and arrival times stay empty. Long-haul legs to and from home have no times at all.
- Evidence records cite the pack's sources with their check date. They say "documented way to travel", never "scheduled", "available" or "booked".
- No prices are invented. The budget stays incomplete until you add allowances or quotes.

## 9. The plan is only a proposal

The result becomes a `SetItinerary` command and goes through the same preview → apply pipeline as any manual edit (`src/application/proposal.ts`). That pipeline:

- refuses the change if a locked stay, activity or journey would move;
- refuses any attempt by the planner to mark evidence as a dated timetable, a live quote or a booking;
- shows the full diff and every check that would change.

You decide whether to apply it, and you can undo it afterwards.

## 10. Surprises

`suggestSurprises()` (`src/planner/surprise.ts`) picks at most three experiences that are not yet in the plan, on different days. Candidates are catalogue activities where you stay, plus **day trips** to catalogue places that are not on your route and are reachable by a non-flight connection of at most 150 minutes each way (for example Bangkok → Ayutthaya, Ko Samui → Ko Pha-ngan, Ao Nang → Ko Lanta).

A surprise only goes on a day that:

- has no fixed event and no protected rest;
- has no travel;
- still has at least two free parts, so one stays free afterwards;
- respects recovery mornings and day-of-week schedules.

Day trips and full-day outings need an empty day. Experiences that add an interest the plan lacks rank higher. Asking again rotates through further ideas deterministically. Each suggestion is an `AddActivity` proposal with source links (the activity and, for day trips, the connection). It needs your Apply like everything else.

Activities that only run on certain weekdays keep that schedule. If an edit later moves one to another day (for example by shifting a stay), the checks flag it as unresolved instead of hiding it.

## Complexity

With 15 places, a beam of 160 and at most 8 stops, a plan takes about 10–60 ms in Node on a laptop. The dynamic programme has at most `stops × nights × (run+1)² × (days+1)` states.

## Known limits

- One region per pack. Planning across packs, or across a whole continent, is not supported yet.
- Travel is modelled as stop-to-stop transfers. Day trips with a return the same day are activities, not stays.
- Season guidance uses the trip's middle month for every stop.
- No price optimisation: there is no price data in the pack.
