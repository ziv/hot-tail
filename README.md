# Hot Tail

An arcade-speed jet combat shooter for the web — third-person chase view, lock-on missile volleys, barrel rolls and short, loud stages. Original IP; free to play.

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
