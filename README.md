# Hot Tail

An arcade-speed jet combat shooter for the web — third-person chase view, lock-on missile volleys, barrel rolls and short, loud stages. Original IP; free to play. See [the project outline](./Afterburner-Style%20Web%20Game%20—%20Full%20Project%20Outline.md) for the full plan.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Useful URL flags: `?debug` (tuning panel, timeline scrubber, cheats, all practice stages unlocked — also the <kbd>`</kbd> key), `?quality=low|medium|high`, `?autotest` (autopilot plays stage 1; used by the smoke test).

Deploy: game + API go to **Vercel** (Hobby) with a **Supabase** (free) database — setup steps in [server/README.md](./server/README.md). `pnpm build:vercel` produces the deployable output. Without a configured API, scores are kept locally and everything works offline (the production build is also an installable PWA). Locally: `pnpm dev:api` + `VITE_API_BASE= pnpm dev`.

| Command | What it does |
| --- | --- |
| `pnpm test` | Vitest unit + headless simulation tests (determinism, guidance, director, boss) |
| `pnpm e2e` | Playwright smoke, full-run flows, CSP, perf fly-through (`PERF_BUDGET_MS` to enforce), emulated iPhone/Pixel, and the cross-engine determinism check in Chromium, Firefox and WebKit. Soak: `SOAK_MINUTES=60 pnpm e2e --project=soak` |
| `pnpm balance` | Autopilot sweep of all 18 stages × 3 difficulties → `docs/balance.md` |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | CI gates (see `.github/workflows/ci.yml`) |

## Controls

| Action | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | WASD / arrows, or mouse (click to capture) | Left stick | Left-thumb floating stick |
| Vulcan | Space / J / left mouse | A | AUTO toggle |
| Lock + missiles | Hold K / X / right mouse, release to fire | X / RB | MSL (hold) |
| Barrel roll | L / C, or double-tap a direction | B / LB | ROLL |
| Boost / air-brake | Shift or E / Q or Z | RT / LT | BOOST / BRAKE |
| Flares | R / V | Y | FLARE |
| Pause · fullscreen | Esc / P · F | Start | II |

## Architecture

```
src/
  core/     fixed-timestep loop, mini ECS + pooling, seeded RNG, event bus
  sim/      headless, deterministic gameplay: player flight, weapons + PN guidance,
            enemies/behaviours/fire patterns, boss framework, stage director,
            collision (spatial hash + swept spheres), scoring, replays
  render/   Three.js view: procedural models, ocean shader, streamed islands/clouds,
            GPU particles, chase camera, bloom/grade/FXAA post chain
  audio/    Web Audio engine, synthesised SFX, procedural music sequencer
  input/    action map over keyboard, pointer lock, gamepad, touch
  ui/       HUD canvas, HTML screen stack, debug panel
  game/     app state machine (boot → title → play → results → …), versioned save
  net/      leaderboard client (online or local fallback), anonymous analytics
  data/     tuning.json, enemies.json, jets.json, stage timelines (hot-reload in dev)
shared/     leaderboard rules shared by client and API (validation, profanity filter)
server/     leaderboard/analytics API — one Vercel function (see server/README.md)
supabase/   Postgres schema + SQL functions for the API (Supabase free tier)
```

The simulation never touches the DOM or WebGL, so it runs in Node for tests and on the server: the same seed + input log reproduces a run bit-for-bit. It avoids engine-specific floating-point (all trigonometry goes through `src/core/dmath.ts`, enforced by lint), so Chromium, Firefox, WebKit and Node produce identical state — which is what lets the API re-simulate submitted runs to validate leaderboard scores. The player's frame is a floating origin: the jet stays near (0,0,0) and the world scrolls past along a rail spline.

All art and audio are procedural placeholders generated at boot — no asset downloads (the whole production build is ≈ 195 KB brotli). Two visual styles are selectable in Settings → Graphics: modern 3D, and a retro sprite-scaling mode that pre-renders every model into angle-indexed sprite atlases at boot and draws entities as billboards at ~288 lines with scanlines.

## Milestone status

- **M1 core prototype — done.** Flight envelope + rail, throttle, roll, vulcan, lock-on volleys, homing missiles, enemy framework, streaming terrain, debug overlay, smoke test.
- **M2 vertical slice — done** (placeholder art/audio). Ocean biome with lighting presets, boss framework, final HUD, menus, results tally, music + SFX, touch layout.
- **M3 alpha — done** (placeholder art/audio). All 12 enemy types (fighters, heavy air, missile-only ground and naval targets), flares, 3 jets, difficulty + dynamic easing, aim assist / auto-fire, scripted loop, tanker refuel, fly-through clouds, radar + threat ring, desert canyon biome, stages 1–6 with Boss 1 (stage 6) and Boss 2 carrier group (practice preview), seeded wave variants, Arcade / Score Attack / Practice, name entry, leaderboards (API + offline), save migrations, key rebinding, accessibility options, attract-mode replays, quality auto-benchmark, PWA.
- **M4 beta — done** (placeholder art/audio). All 18 stages across 5 biomes (ocean, desert canyon, mountains, night city + harbour, stratosphere) with 7 new lighting presets and star fields; Boss 3 stealth ace (cloaking) and Boss 4 orbital platform; take-off and landing cutscenes, credits; 5 new music tracks + limiter; replay-validated leaderboard scores (cross-engine deterministic sim, cron re-simulation in the API); balance pass with per-difficulty tuning; 30/60 fps cap, dynamic resolution, lazy chunks, precompressed build; accessibility audit (`docs/accessibility.md`).
- **M5 release candidate — done.** Full-run regression flows (arcade → refuel → final boss → landing → credits, game over → name entry, settings persistence), emulated iPhone/Pixel touch tests, CSP/security-header test, browser + simulated-hour soak tests (found and fixed a GPU texture leak), boss phase-order fix, mobile HUD layout fix, error reporting (J7) + status page + uptime workflow, privacy policy and in-game score deletion, licence notices, legal/naming review (`docs/legal-review.md`), key art, screenshots, trailer and landing page (`/about.html`).
- **M6 launch — ready.** Release/rollback/patch runbook in [docs/release.md](./docs/release.md) (beta = Vercel preview of the `beta` branch, instant rollback), [CHANGELOG.md](./CHANGELOG.md), itch.io package (`node scripts/package-itch.mjs`), press kit and launch post drafts in `docs/launch/`. Publishing the posts and portal pages is a manual step.
- Deferred: glTF/KTX2 pipeline (A7) until real art exists; on-device mobile passes (K4, Q5) — need physical devices (checklist in `docs/release.md`); contracted music/SFX (H6/H7); localisation (K8) dropped — English only by decision; ad-based portals (Poki, CrazyGames) skipped — they require ads.
