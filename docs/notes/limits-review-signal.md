# Overturned goals: is there a usable review signal? (researched 2026-10-19, nothing implemented)

Question: can Homeroom hold a goal alert while a review is pending, and drop it silently on overturn (`review_hold_s`)?

## What the feeds expose
Sampled 30 finished NHL games (2025-26 regular season, `api-web.nhle.com/v1/gamecenter/<id>/play-by-play`, 208 goals) and
ESPN summaries for NHL/NFL/NBA games.

- NHL play-by-play has `typeDescKey: "stoppage"` with `details.reason` / `details.secondaryReason`. Review-related values seen:
  `chlg-vis-goal-interference`, `chlg-hm-goal-interference`, `chlg-vis-off-side`, `chlg-hm-off-side`, `video-review`
  (alone, or as secondary reason of `referee-or-linesman`, `high-stick`). About 20 per 30 games, and only some concern goals
  (`video-review` also covers penalty/high-stick reviews).
- ESPN NHL plays: "Challenge Hm - goal interference - goal Stoppage", "Video Review Stoppage" (no goal linkage). NBA/NFL review plays exist
  but are play-call reviews, not scoring-play recalls.

## Why it is not reliable enough to build on
1. **Final data only.** An overturned goal is *deleted* from the feed, so historical games contain the stoppage marker but not the goal it
   removed (e.g. game 2025021203: `chlg-vis-goal-interference` at 06:11 of P2 with no goal near it; 2025021200: `chlg-vis-off-side` with an
   `offside` stoppage). I could not observe the live ordering "goal added -> review stoppage added -> goal removed", nor its latency.
2. **Ambiguous order in the final feed.** Same-second events are sorted arbitrarily: in confirmed goals the challenge stoppage appears before
   (2025021196, 2025021203) or after (2025021188, 2025021216) the goal.
3. **A review marker does not mean the goal is at risk**: most `chlg-*` and `video-review` stoppages in the sample were upheld goals,
   penalty/high-stick reviews, or offside challenges on plays without a goal.
4. No live game was available during the research window (11:00 ET Monday), so there was no way to capture a live sequence.

A hold built on this would delay every reviewed goal by the full hold with no measured benefit, and could swallow a real goal if a marker
appears for an unrelated review. Per the brief, no speculative code was added.

## What would make it buildable
Record the live NHL play-by-play (`plays` array, every 1 s) for a few weeks of games into a local file (a 20-line recorder in the poller
behind an env flag), then find games where a goal event appears and later disappears. Only with that data can you tell (a) which marker
precedes the removal, (b) how many seconds earlier, and (c) the false-positive rate. Until then the existing behaviour stays: a score drop after
an announced goal produces a UI/REST-only `goal_overturned` after a 20 s confirm window.
