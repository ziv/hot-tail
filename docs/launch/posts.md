# Launch post drafts (R7)

Drafts only — nothing has been posted. Live address: https://hot-tail.vercel.app.

## Dev log (itch.io / blog)

**Hot Tail is out — arcade jet combat in your browser**

Hot Tail started as a question: can an 80s super-scaler arcade jet game feel right in a browser tab, on a phone, with no download? It's now 18 stages and four bosses, and the whole game — models, textures, music and sound — is generated in code, so it loads in about 200 KB.

A few things I'm proud of:
- **Fair leaderboards.** Every submitted score comes with its input recording, and the server replays the run with the exact same simulation before it counts. That only works because the simulation is bit-identical in Chrome, Firefox, Safari and Node — which meant replacing every trig call with a deterministic implementation.
- **Two looks.** Flip Settings → Graphics → Style to "Retro sprites" and every 3D model is pre-rendered into a sprite sheet at startup, super-scaler style.
- **Free and quiet.** No ads, no accounts, no cookies. Anonymous stats can be switched off, and you can delete your scores from the settings.

Play: https://hot-tail.vercel.app

## Show HN

**Show HN: Hot Tail – an arcade jet shooter in the browser with replay-verified leaderboards**

Hot Tail is a free After Burner-style jet combat game in Three.js/TypeScript: 18 stages, 4 bosses, lock-on missile volleys, touch and gamepad support, ~200 KB total because all art and audio are procedural.

The part HN might find interesting: leaderboard scores are verified by re-simulating the submitted input log on the server (a Vercel function; a full 25-minute run replays in ~0.7 s). To make that work across browsers, the sim avoids Math.sin/exp/acos and three.js trig helpers entirely — a small deterministic math module plus a lint rule — and a Playwright test checks that Chromium, Firefox and WebKit produce the same state hash as Node.

https://hot-tail.vercel.app

## Reddit (r/WebGames, r/indiegaming, r/shmups)

**[Web] Hot Tail — free arcade jet combat, 18 stages & 4 bosses, runs on your phone too**

Lock on to up to 8 targets and let the missiles fly, roll through incoming fire, and take down a flying fortress, a carrier group, a cloaking stealth ace and an orbital platform. Keyboard/mouse, gamepad or touch. No ads, no sign-up. There's also a retro sprite mode if you miss the 80s arcade look. Feedback very welcome! https://hot-tail.vercel.app

## Social (short)

Hot Tail is live 🔥✈️ Arcade jet combat in your browser — 18 stages, 4 giant bosses, lock-on missile volleys. Free, no ads, works on phones. https://hot-tail.vercel.app
