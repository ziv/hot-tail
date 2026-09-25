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

Weekly boards reset at Monday 00:00 UTC. Raw IPs are never stored (salted hash only). Replays are stored with each score for the re-simulation check planned in M4 (J4).

## Deploy

```bash
npx wrangler d1 migrations apply hot-tail-dev --local
npx wrangler dev                      # http://localhost:8787
npx wrangler deploy --env staging
```

Then build the game with `VITE_API_BASE=https://<worker-host>` so it talks to the API; without it the game keeps scores locally.
