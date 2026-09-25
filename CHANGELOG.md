# Changelog

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
