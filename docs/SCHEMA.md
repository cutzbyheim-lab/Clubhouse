# Database schema

Source of truth: `src/main/db/migrations/`. This page is the map.

```
player_profile (single row)

club ──< bag_club >── bag                      equipment
  │
  └──< shot >── session ──? round              measurements
         │                   │
         └──? hole_score >───┘
                  │
course ──< hole ──┘
  │         │
  └──< course_tee ──< hole_length >── hole

drill ──< practice_plan_item >── practice_plan
  └──< practice_log ──? practice_plan          practice

insight_dismissal                               intelligence
```
`──<` one-to-many · `──?` optional reference

## Rules the schema enforces

| Rule | How |
|---|---|
| Measurements are never fabricated | `source ∈ {manual, imported, sample}` on every measured table; uncaptured values are `NULL`, never `0` |
| Physically plausible numbers only | `CHECK` ranges on every shot metric (e.g. carry 0–400 m, ball speed 0–95 m/s) |
| Derived values are not stored | GIR, scrambling, smash factor, averages are computed at read time |
| 14-club limit (Rule 4.1b) | `bag_club_limit` trigger |
| One active bag | partial unique index `bag_one_active` |
| Consistent scores | `putts ≤ strokes`, `putts + penalties ≤ strokes`, one score per hole per round |
| Valid dates and times | `date(x) IS x`, ISO-8601 timestamp checks |
| History can't be orphaned | `RESTRICT` on courses/holes/clubs referenced by rounds or shots; `CASCADE` from a round to its scores and on-course sessions |
| Insights are not data | only dismissals persist; insights are recomputed from rows |

## Units

| Quantity | Stored as |
|---|---|
| distance, height, length | metres |
| speed | metres per second |
| angles | degrees (signed: + right / up / open) |
| spin | rpm |
| mass | grams |

Display units come from `player_profile.distance_unit` / `speed_unit`.

## Tables

| Table | Holds |
|---|---|
| `player_profile` | name, handedness, handicap index as the player states it, unit preferences |
| `club` | every club owned; specs are player-entered |
| `bag`, `bag_club` | bag configurations and slot order |
| `course`, `course_tee`, `hole`, `hole_length` | course data from the scorecard; `hole.geometry` is JSON layout for the 3D view |
| `round`, `hole_score` | scored rounds, hole by hole |
| `session`, `shot` | launch-monitor, range, simulator and on-course shots |
| `drill`, `practice_plan`, `practice_plan_item`, `practice_log` | drill library, planned sessions, logged practice |
| `insight_dismissal` | insights the player chose to hide |
