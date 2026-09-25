# Hot Tail

An arcade-speed jet combat shooter for the web — third-person chase view, lock-on missile volleys, barrel rolls and short, loud stages. Original IP; free to play. See [the project outline](./Afterburner-Style%20Web%20Game%20—%20Full%20Project%20Outline.md) for the full plan.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Useful URL flags: `?debug` (tuning panel, timeline scrubber, cheats — also the <kbd>`</kbd> key), `?quality=low|medium|high`, `?autotest` (autopilot plays stage 1; used by the smoke test).

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
  game/     app state machine (boot → title → play → results → …), settings
  data/     tuning.json, enemies.json, stage timelines (hot-reload in dev)
```

The simulation never touches the DOM or WebGL, so it runs in Node for tests: the same seed + input log reproduces a run bit-for-bit. The player's frame is a floating origin: the jet stays near (0,0,0) and the world scrolls past along a rail spline.

All art and audio are procedural placeholders generated at boot — no asset downloads (production build ≈ 200 KB gzipped).

## Milestone status

- **M1 core prototype — done.** Flight envelope + rail, throttle, roll, vulcan, lock-on volleys, homing missiles, enemy framework, streaming terrain, debug overlay, smoke test.
- **M2 vertical slice — done** (with placeholder art/audio). Polished ocean biome with 3 lighting presets, 3 stages incl. the *Leviathan* flying-fortress boss (3 phases), 4 fighter types, final HUD, menus, results tally, music + SFX, touch layout.
- Deferred from M0–M2: glTF/KTX2 asset pipeline (A7) and real asset loading (B4) until real art exists; preview-deploy pipeline (A3); error reporting endpoint (J7, errors are captured locally); on-device mobile profiling (K4).
