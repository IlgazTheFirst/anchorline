# Anchorline commands

Changes are typed commands. Put one in a file, an array of them, or `{"label": "...", "commands": [...]}`, then `anchorline preview` it. Ids come from the trip JSON: `stays[].id`, `travelLegs[].id`, `activities[].id`, `anchors[].id`, `places[].id`. Dates are `YYYY-MM-DD`, times are `{"localDateTime": "YYYY-MM-DDTHH:MM", "timeZone": "Area/City"}`.

## Stays

```json
{"type": "ResizeStay", "stayId": "stay_2_chiang_mai", "nights": 5, "shiftFollowing": true}
{"type": "ChangeStayDates", "stayId": "stay_2_chiang_mai", "checkIn": "2031-02-06", "checkOutExclusive": "2031-02-10", "shiftFollowing": false}
{"type": "MoveStay", "stayId": "stay_2_chiang_mai", "direction": "earlier"}
{"type": "RemoveStay", "stayId": "stay_3_phuket", "closeGap": true}
{"type": "ReplaceStop", "stayId": "stay_3_phuket", "place": {"id": "ko_lanta", "name": "Ko Lanta", "timeZone": "Asia/Bangkok", "tags": ["beach"], "dataKind": "curated", "catalogueId": "ko_lanta"}}
{"type": "AddStay", "stay": {"id": "stay_extra", "placeId": "custom_friends_house", "checkIn": "2031-02-10", "checkOutExclusive": "2031-02-12", "purposeTags": [], "lockedFields": []}, "place": {"id": "custom_friends_house", "name": "A friend's house", "timeZone": "Asia/Bangkok", "tags": [], "dataKind": "user", "catalogueId": null}, "shiftFollowing": true}
{"type": "UpdateStay", "stayId": "stay_1_bangkok", "patch": {"accommodation": {"name": "Hotel name"}}}
```

`shiftFollowing: true` moves later stops, their activities and journeys by the same number of days. Replacing a stop keeps its dates; the old route's evidence and times stop applying.

## Activities and journeys

```json
{"type": "AddActivity", "activity": {"id": "act_market", "placeId": "bangkok", "title": "Flower market", "date": "2031-02-04", "partOfDay": "morning", "tags": ["culture"], "lockedFields": [], "dataKind": "user"}}
{"type": "UpdateActivity", "activityId": "act_market", "patch": {"date": "2031-02-05"}}
{"type": "RemoveActivity", "activityId": "act_market"}
{"type": "UpdateTravelLeg", "legId": "leg_home_return", "patch": {"departure": {"localDateTime": "2031-02-16T10:00", "timeZone": "Asia/Bangkok"}, "arrival": {"localDateTime": "2031-02-16T17:30", "timeZone": "Europe/London"}}}
```

Times entered by a suggestion are recorded as planning assumptions, not as times the person entered.

## Commitments, locks and preferences

```json
{"type": "AddAnchor", "anchor": {"id": "anchor_beach", "kind": "minimum_consecutive_nights", "strength": "hard", "qualifyingTag": "beach", "minimumNights": 5}}
{"type": "AddAnchor", "anchor": {"id": "anchor_cm", "kind": "minimum_nights_at_place", "strength": "hard", "placeId": "chiang_mai", "minimumNights": 3}}
{"type": "LockField", "subjectId": "stay_1_bangkok", "field": "dates"}
{"type": "SetPreferences", "patch": {"pace": "slow"}}
{"type": "SetTripDetails", "title": "New name", "travellers": {"count": 3, "rooms": 2}}
```

Other anchor kinds: `minimum_full_days`, `required_place`, `excluded_place`, `arrival_deadline`, `fixed_event`, `protected_rest`.

## Budget and evidence

```json
{"type": "AddBudgetItem", "item": {"id": "b1", "subjectId": "stay_1_bangkok", "label": "Hotel allowance", "currency": "GBP", "minorUnitDigits": 2, "unitAmountMinor": 9000, "priceBasis": "per_room_night", "quantity": {"rooms": 1, "nights": 4}, "status": "user_allowance"}}
{"type": "SetFx", "fx": [{"from": "THB", "to": "GBP", "rate": 0.022, "asOf": "2031-01-01", "source": "user_entered"}]}
{"type": "AddClaim", "claim": {"id": "c1", "subjectId": "leg_1_bangkok_chiang_mai", "kind": "route_timing", "evidenceStatus": "planning_assumption", "sourceUrl": "https://example.org", "checkedAt": "2031-01-01", "dataKind": "user"}}
```

## Refused for suggestions

Without `--as-user` (and always through MCP), these are rejected:

- `RecordBooking`, `RemoveBookingMark`
- `UnlockField`
- `RemoveAnchor` on a hard commitment
- `SetTravellerDetails`, `SetPrivateNote`, `RemovePrivateNote`
- any evidence marked `source_documented`, `dated_schedule`, `live_quote` or `user_recorded`
- any budget line marked `dated_quote` or `booked_cost`
