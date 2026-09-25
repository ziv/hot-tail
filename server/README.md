# Hot Tail API

Serverless leaderboard and anonymous gameplay stats for Hot Tail: a Cloudflare Worker (`src/worker.ts`) backed by D1 (`migrations/`). The request handler (`src/handler.ts`) is storage-agnostic and unit-tested with the in-memory store from `shared/leaderboard.ts`.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/scores` | `{playerId, name, score, mode, stage, jet, difficulty, seed, version, replay?}` — validated, profanity-filtered, rate-limited (8 per 10 min per player/IP) |
| GET | `/api/scores?mode=arcade&period=all\|weekly&limit=50` | best score per player |
| GET | `/api/scores/around?mode&period&playerId` | ranks around the player |
| POST | `/api/events` | `{events: [{type, stage, value}]}` → daily aggregates only |
| GET | `/api/health` | |

Weekly boards reset at Monday 00:00 UTC. Raw IPs are never stored (salted hash only).

**Score validation (J4).** Submissions carry the run's input log (seed, options, RLE-compressed inputs, stage/refuel marks). They're stored as `pending`; a cron trigger (every minute) re-simulates up to 5 with the exact game simulation (bundled from `src/sim`) and marks them `verified` or `rejected`. Rejected scores never appear; runs recorded by an older simulation version are kept as `unverifiable`. Re-simulating a full 18-stage run takes a few seconds of CPU, so the worker needs the Workers Paid CPU limit (`[limits] cpu_ms`).

## Deploy

```bash
npx wrangler d1 migrations apply hot-tail-dev --local   # 0001 init, 0002 replay validation
npx wrangler dev                      # http://localhost:8787
npx wrangler deploy --env staging
```

Then build the game with `VITE_API_BASE=https://<worker-host>` so it talks to the API; without it the game keeps scores locally.
