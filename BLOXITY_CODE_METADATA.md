---
canDie: false
hasScore: true
---

# +1 Fill Water Escape: Boxity integration

The player cannot die: there is no death or game-over screen. You scoop Water Power at
the wells, run the escape course pouring it into each pit until one is too deep, and
claim the Wins pad on the furthest ledge you reached, which sends you back to the lobby.

## Leaderboards

Scores are reported by the **game server**, never by the client
(`server/src/bloxityLeaderboards.js`, `BLOXITY_LEADERBOARDS`). Every ~20 s and when a
player leaves, each pod sends the changed scores of its verified players to
`POST {api}/v1/leaderboards/hosted/{BLOXITY_GAME_ID}/report` as `legion_<userId>`.

| Board      | Label            | Score                                | Format  |
|------------|------------------|--------------------------------------|---------|
| `rebirths` | Rebirths         | `profile.rebirths`                   | number  |
| `wins`     | Total Wins       | `profile.stats.totalWins`            | compact |
| `stage`    | Best Stage       | `overallStage(stats)`: World 1's stage (1-59), then 59 + World 2's (60-118) | number |
| `playtime` | Minutes Played   | `floor(profile.stats.playtime / 60)` | number  |
| `wins_week` | Wins This Week  | `weekWins(profile)`: Wins from pads and coins since Monday 00:00 UTC | compact |

All are `order: desc`, `mode: best`. `wins_week` has `reset: weekly` (Boxity's week starts
Monday 00:00 UTC, as the in-game weekly board's does); the rest `reset: none`. The client
declares the same boards with `Legion.SDK.leaderboard.define()` right after `init()`
(`client/src/bloxity/integration.js`); keep the two lists in step.

## Loading the SDK

`client/index.html` loads `https://sdk.bloxity.io/v1/legion-sdk.min.js` with a plain
script tag (no `async`/`defer`) before the game's code, as Boxity's spec and its
reference game do: it has to run before the first matchmaker request (party play) and
before CrazyGames' play-with-friends. The game connects only through
`Legion.SDK.net.resolveEndpoint`, never to `<id>.host.bloxity.io`.

## Gems purchases

Boxity's purchase webhook goes to `POST /api/gems/webhook` on the game server. It is
recorded in the database by `transactionId` (idempotent) and applied exactly once by
the pod the buyer plays on. Unknown skus are answered 400 so Boxity refunds them.

## Rewarded ads

The client sends `adReward { placement, rewardToken }`; the server verifies the token
with `POST {api}/v1/ads/reward/verify` before granting anything.

## Open Rooms

Each pod reports its rooms every 2 s to `POST {MATCHMAKER_REPORT_URL}/{BLOXITY_GAME_ID}/rooms`
(`server/src/legionRoomReporter.js`, installed after `listen()`), so they show under
"Open Rooms" on the game page. The client joins `?roomId=` at launch and falls back to
normal matchmaking if that room is gone or full.

## Avatars

`client/src/game/PlayerAvatar.jsx` + `avatarRig.js` draw every slot: skin (with face,
shirt and pants), body parts, hat + hair + mask on `Neck1`, back on `Spine2`, neck/chest
on `Spine2` and waist on `Spine1` (rest-inverse placement), hands and shoes as mirrored
pairs following the leaf bones' position and rotation only. A player wearing an uploaded
character (`characterId`) gets its GLB via `avatar.getCharacter()` / `getCharacterFor()`,
with accessories fitted by `characterAccessoryMatrix`; on any failure the regular avatar
shows. Body proportions are applied by moving bones, so accessories follow them.

## Server environment

| Variable                | Purpose                                                       |
|-------------------------|---------------------------------------------------------------|
| `BLOXITY_REPORT_TOKEN`  | Token for leaderboard and room reports (none set = no reports) |
| `MATCHMAKER_REPORT_URL` | Where the Open Rooms reporter posts (injected by Boxity hosting) |
| `BLOXITY_GAME_ID`       | Hosted game id for reports (default `1-fill-water-escape`)    |
| `LEGION_WEBHOOK_SECRET` | Must match the webhook's `x-legion-webhook-secret` header     |
| `MONGODB_URI`           | Shared database for profiles and Gems grants (SQLite without) |
| `BLOXITY_API_URL` etc.  | Platform URLs; production defaults (`server/src/bloxityEnv.js`) |
