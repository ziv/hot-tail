# Accessibility audit (Q8)

Checked against the settings checklist from the project outline (K7) on the M4 beta build. ✅ = shipped and verified in-game, ⚠️ = partial / needs device or user testing.

| Area | Requirement | Status | Notes |
| --- | --- | --- | --- |
| Colour | Colour is never the only cue | ✅ | Locks = rotating diamond + "LOCK" text; threats = warm colour + "MISSILE WARNING" box + arrows; radar uses shapes (▲ air, ■ ground/boss, ● missiles). |
| Colour | Colour-blind palettes | ✅ | Settings → Accessibility → HUD colours: standard, red-green safe (blue/yellow/white), blue-yellow safe (pink/red/white). Enemy shots stay warm orbs vs cool player tracers (shape differs too). |
| Motion | Screen shake toggle | ✅ | Settings → Accessibility → Screen shake. |
| Motion | Flash toggle | ✅ | Disables damage/explosion full-screen flashes. |
| Motion | Reduced motion | ✅ | `prefers-reduced-motion` stops menu transitions and the credits scroll. |
| Input | Hold vs toggle | ✅ | Lock and afterburner can be press-to-toggle. |
| Input | Rebinding | ✅ | All keyboard actions, primary + alternate key, reset to defaults. |
| Input | Assists | ✅ | Aim assist and auto-fire (touch defaults to auto-fire). |
| Input | Every screen reachable by keyboard/gamepad | ✅ | Arrow/D-pad focus, Enter/A confirm, Esc/B back; covered by the Playwright flow test. |
| Hearing | Subtitles for callouts | ✅ | On by default; optional synthesised voice. Missile alarm always has a visual warning. |
| Readability | HUD scale | ✅ | 0.85× – 1.4×. |
| Difficulty | Options | ✅ | Easy / Normal / Hard + dynamic easing after two deaths in a stage. |
| Screen reader | Menus | ⚠️ | Menus are native `<button>`s with labels; the in-game HUD is a canvas (not announced). |
| Device | Touch targets ≥ 44 px | ✅ | Touch buttons are 64 px. |
| Device | Real-device pass (iOS/Android) | ⚠️ | Not yet done — needs physical devices (Q5, M5). |
