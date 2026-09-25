# Hot Tail

An arcade-speed jet combat shooter for the web — third-person chase view, lock-on missile volleys, barrel rolls and short, loud stages. Original IP; free to play. See [the project outline](./Afterburner-Style%20Web%20Game%20—%20Full%20Project%20Outline.md) for the full plan.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Useful URL flags: `?debug` (tuning panel, timeline scrubber, cheats, all practice stages unlocked — also the <kbd>`</kbd> key), `?quality=low|medium|high`, `?autotest` (autopilot plays stage 1; used by the smoke test).

Online leaderboard: set `VITE_API_BASE` to a deployed [Hot Tail API](./server/README.md) at build time. Without it, scores are kept locally and everything else works offline (the production build is also an installable PWA).

| Command | What it does |
| --- | --- |
| `pnpm test` | Vitest unit + headless simulation tests (determinism, guidance, director, boss) |
| `pnpm e2e` | Playwright smoke test, keyboard-nav test, perf fly-through (`PERF_BUDGET_MS` to enforce) |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | CI gates (see `.github/workflows/ci.yml`) |

## Controls

| Action | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Steer | WASD / arrows, or mouse (click to capture) | Left stick | Left-thumb floating stick |
| Vulcan | Space / J / left mouse | A | AUTO toggle |
| Lock + missiles | Hold K / X / right mouse, release to fire | X / RB | MSL (hold) |
| Barrel roll | L / C, or double-tap a direction | B / LB | ROLL |
| Afterburner / air-brake | Shift or E / Q or Z | RT / LT | BOOST / BRAKE |
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
server/     Cloudflare Worker + D1 leaderboard/analytics API
```

The simulation never touches the DOM or WebGL, so it runs in Node for tests: the same seed + input log reproduces a run bit-for-bit. The player's frame is a floating origin: the jet stays near (0,0,0) and the world scrolls past along a rail spline.

All art and audio are procedural placeholders generated at boot — no asset downloads (production build ≈ 215 KB gzipped). Two visual styles are selectable in Settings → Graphics: modern 3D, and a retro sprite-scaling mode that pre-renders every model into angle-indexed sprite atlases at boot and draws entities as billboards at ~288 lines with scanlines.

## Milestone status

- **M1 core prototype — done.** Flight envelope + rail, throttle, roll, vulcan, lock-on volleys, homing missiles, enemy framework, streaming terrain, debug overlay, smoke test.
- **M2 vertical slice — done** (placeholder art/audio). Ocean biome with lighting presets, boss framework, final HUD, menus, results tally, music + SFX, touch layout.
- **M3 alpha — done** (placeholder art/audio). All 12 enemy types (fighters, heavy air, missile-only ground and naval targets), flares, 3 jets, difficulty + dynamic easing, aim assist / auto-fire, scripted loop, tanker refuel, fly-through clouds, radar + threat ring, desert canyon biome, stages 1–6 with Boss 1 (stage 6) and Boss 2 carrier group (practice preview), seeded wave variants, Arcade / Score Attack / Practice, name entry, leaderboards (API + offline), save migrations, key rebinding, accessibility options, attract-mode replays, quality auto-benchmark, PWA.
- Deferred: glTF/KTX2 pipeline (A7) until real art exists; preview-deploy pipeline (A3); error-report endpoint (J7); on-device mobile passes (K4, Q5) — need physical devices; contracted music/SFX (H6/H7).
