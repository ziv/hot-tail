# Hot Tail API — Vercel + Supabase (free tiers)

The leaderboard and anonymous stats API runs as **one Vercel serverless function** next to the static game (same origin, no CORS), backed by a **Supabase Postgres** database. Both fit the free plans: Vercel Hobby and Supabase Free.

```
server/handler.ts          storage-agnostic request handler (routing, validation, rate limits, CORS)
server/supabase.ts         Supabase store: every call is an RPC to the SQL functions below
server/validate-replay.ts  J4: re-simulates a submitted run with the game's own simulation
server/vercel.ts           Vercel Node function entry (reads env, adapts Node req/res)
server/dev.ts              local API for `pnpm dev:api` (in-memory, or Supabase if env is set)
supabase/migrations/       tables, indexes, RLS and the lb_* / stats_* SQL functions
scripts/build-vercel.mjs   `pnpm build:vercel` → .vercel/output (Build Output API)
```

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/scores` | `{playerId, name, score, mode, stage, jet, difficulty, seed, version, replay?}` — validated, profanity-filtered, rate-limited (8 per 10 min per player/IP). The replay is re-simulated inline (a full 18-stage run takes ≈0.7 s) and the response carries `status: verified \| rejected \| unverifiable`. |
| GET | `/api/scores?mode=arcade&period=all\|weekly&limit=50` | best score per player; rejected runs never appear |
| GET | `/api/scores/around?mode&period&playerId` | ranks around the player |
| POST | `/api/events` | `{events: [{type, stage, value}]}` → daily aggregates only |
| GET | `/api/cron/validate` | daily sweep of any runs left `pending`; requires `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it) |
| GET | `/api/health` | |

Weekly boards reset Monday 00:00 UTC. Raw IPs are never stored (salted SHA-256 only). Runs recorded by an older simulation version are kept as `unverifiable`.

## Security model

- The browser never talks to Supabase. Only the Vercel function does, with the **service-role key** held in Vercel's server-side environment.
- Tables have row-level security enabled with **no policies**, and the SQL functions are revoked from `anon`/`authenticated`, so the project's public anon key can read or write nothing.

## Setup (≈10 minutes, no credit card)

1. **Supabase** — create a free project at supabase.com. In *SQL Editor*, paste and run `supabase/migrations/20260925120000_leaderboard.sql` (or `supabase link` + `supabase db push` with the CLI). From *Project Settings → API* copy the **Project URL** and the **service_role** key.
2. **Vercel** — import the Git repository (Hobby plan). `vercel.json` already sets the install/build commands; no framework preset needed. Add environment variables:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | Project URL from step 1 |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (server-only — never prefix with `VITE_`) |
   | `IP_SALT` | any long random string |
   | `CRON_SECRET` | any long random string |

3. Deploy. The game on that domain automatically uses `/api` (the build sets `VITE_API_BASE` to same-origin); the daily cron is registered from the build output.

To host the game elsewhere and point it at this API, build with `VITE_API_BASE=https://hot-tail.vercel.app` and set `ALLOWED_ORIGIN` on Vercel to the game's origin.

## Free-tier notes

- **Vercel Hobby** allows one cron run per day — enough, because scores are validated inline at submit time; the cron only mops up. Hobby is for non-commercial use, which fits a free game with no ads.
- **Supabase Free** pauses a project after about a week without traffic. The game keeps working offline (local scores) while it's paused; restore it from the dashboard or keep it warm with regular play.

## Local development

```bash
pnpm dev:api                 # API on :8787 (in-memory board; set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to use a real project)
VITE_API_BASE= pnpm dev      # game on :5173, /api proxied to :8787
```

Tests: `tests/supabase.test.ts` runs the real migration in PGlite (Postgres in WebAssembly) through the same RPC calls; `tests/vercel-bundle.test.ts` exercises the built function end to end through supabase-js.
