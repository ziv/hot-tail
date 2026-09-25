# Release runbook (R1, R2, R8 · M5–M6)

Everything here runs on free tiers: Vercel Hobby (hosting + API), Supabase Free (database), GitHub Actions (CI + uptime).

## Channels

| Channel | Where | Who |
| --- | --- | --- |
| **Production** | Vercel production deployment of `main` — https://hot-tail.vercel.app | Everyone |
| **Beta** | Vercel *preview* deployment of the `beta` branch (stable preview URL `hot-tail-git-beta-<team>.vercel.app`) | Playtesters |
| **PR previews** | One Vercel preview per pull request | Review |

Preview deployments share the production Supabase project by default. To keep test scores out of the real board, create a second free Supabase project and set its URL/key on the **Preview** environment in Vercel.

## Release candidate checklist (M5 exit)

1. `pnpm run ci` green (lint, typecheck, unit/sim tests, build), then `pnpm build:vercel && pnpm vitest run tests/vercel-bundle.test.ts`.
2. `pnpm e2e` green: smoke, full flows, CSP, determinism in Chromium/Firefox/WebKit, emulated iPhone/Pixel.
3. Soak: `pnpm build && SOAK_MINUTES=60 pnpm exec playwright test e2e/soak.spec.ts --project=soak` — heap, GPU resources and music timing must stay flat.
4. Balance sanity: `pnpm balance` and compare `docs/balance.md` with the previous release.
5. Real devices (needs hardware): one iPhone (Safari), one mid-range Android (Chrome), one integrated-GPU laptop — play stage 1, a boss stage, switch to retro, post a score, check `/status.html` shows no new errors.
6. Merge to `beta`, share the beta URL with testers for a few days, watch `/status.html`.
7. Bump `version` in `package.json`, update `CHANGELOG.md`, bump `SIM_VERSION` (and `e2e/golden.ts`) if gameplay changed, tag `vX.Y.Z`, merge to `main`.

## Deploying

Pushing to `main` deploys production via the Vercel Git integration (build command `pnpm build:vercel` from `vercel.json`). Apply any new Supabase migration **before** merging code that needs it:

```bash
supabase db push            # or paste the new file from supabase/migrations/ into the SQL editor
```

Migrations are additive (new functions/tables), so the previous deployment keeps working during the switch.

## Rollback

- **Instant:** Vercel dashboard → Deployments → previous production deployment → *Instant Rollback* (or `vercel rollback`). Static game and API roll back together.
- Players get the rolled-back build on next load; the service worker's update prompt handles open tabs.
- Database: migrations only add functions/tables, so no DB rollback is needed for a code rollback.
- If a release broke replay validation, bump `SIM_VERSION` in the fix — scores from the bad build become `unverifiable` instead of `rejected`.

## Monitoring

- **Status page:** `/status.html` — API/DB health, load-time p50/p95, errors in the last 24 h with the most recent messages, scores verified/rejected, weekly play counters.
- **Uptime alerts:** `.github/workflows/uptime.yml` checks the site, the deep health endpoint and the error rate every 30 minutes. It checks https://hot-tail.vercel.app by default (override with the repository variable `SITE_URL`); GitHub emails you when a run fails. The regular DB touch also stops the free Supabase project from pausing.
- **Error reports:** client errors are grouped by fingerprint in the `client_errors` table (Supabase → Table editor) with version and user-agent.
- **Vercel:** Deployments → Functions logs for API errors; Analytics is available on Hobby if you want page views.

## Patch process (M6: first patch within 2 weeks)

1. Triage daily for the first week: `/status.html` errors (by version), leaderboard rejections (a spike means a determinism break), player feedback.
2. Severity: **P0** crash/boot failure/data loss → hotfix same day; **P1** blocks progress or breaks scoring → next patch; **P2/P3** → backlog.
3. Fix on a branch, add a regression test (unit or e2e) reproducing it, ship to `beta`, then `main` as `1.0.x`.
4. Note it in `CHANGELOG.md`.
