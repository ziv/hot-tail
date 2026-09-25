# Changelog

## 1.1.0

- New aircraft models: all 13 aircraft (the three player jets, fighters, drones, aces, bomber, attack helicopter, AWACS, tanker, the Wraith and missiles) rebuilt with smooth lofted fuselages, airfoil wings, glass canopies, open intakes, see-in metal nozzles, underwing missiles, two-tone paint and panel lines.
- Model viewer for development at `/tools/models.html`.

## 1.0.1

- Touch: tapping the game view on a touchscreen laptop or Chromebook no longer grabs mouse pointer lock (which made the on-screen buttons stop responding).
- CI: the cross-browser determinism check no longer needs WebGL (headless Firefox on Linux has none); smoke test made robust on slow runners; failed tests keep a Playwright trace.

## 1.0.0 — launch

First public release.

- 18 stages across ocean, desert canyon, mountains, night city/harbour and the stratosphere; 4 bosses; take-off and landing cutscenes.
- 3 jets, 12 enemy types, lock-on missile volleys, flares, barrel rolls, boost/air-brake, scripted loops, tanker refuelling.
- Arcade, Score Attack (weekly seed) and Practice; leaderboards with server-side replay verification.
- Modern 3D and retro sprite-scaling styles; keyboard, mouse, gamepad and touch; rebinding and accessibility options.
- Offline-capable PWA, anonymous stats and error reports (opt-out), in-game score deletion.

### Release-candidate fixes (M5)

- Fixed a GPU texture leak on every stage start (reflection environment map was never fully released).
- Fixed a boss that could get stuck when weak points died out of phase order.
- Touch: HUD no longer hidden behind the on-screen buttons (status block moves up, radar lifts in portrait); cutscenes can be skipped with a tap; the rotate hint no longer covers the score.
- Leaderboard rank for players without a score (was reported as #1).
- Service worker no longer reloads the page on first install.
- Security headers (CSP etc.) on all responses; licence notices and privacy policy added.
