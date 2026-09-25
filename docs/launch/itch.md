# itch.io page (R6)

## Package

```bash
node scripts/package-itch.mjs   # leaderboard API: https://hot-tail.vercel.app
```

On Vercel, add `https://html-classic.itch.zone` to `ALLOWED_ORIGIN` so the itch build can post scores, then redeploy.

## Upload settings

- Kind of project: **HTML**; upload `release/hot-tail-itch.zip`, tick *This file will be played in the browser*.
- Embed: 1280 × 720, *Mobile friendly* (landscape), *Fullscreen button*, *Automatically start on page load* **off** (audio needs a click).
- Pricing: **No payments** (the game is free with no ads — donations can be left off).
- Genre: Shooter · Tags: arcade, flight, jets, shoot-em-up, 3d, retro, singleplayer, touch, gamepad, high-score.
- Cover image: crop `public/media/keyart.jpg` to 630×500; screenshots from `public/media/shots/`; trailer: upload `public/media/trailer.mp4` to YouTube (unlisted is fine) and paste the link.

## Page copy

> **Hot Tail** — arcade jet combat, straight from the 80s cabinet.
>
> Sweep your reticle across the sky, lock up to eight targets and let the missiles fly. Barrel-roll through tracer fire, dump flares, top up from a tanker mid-flight — then face a flying fortress, a carrier battle group, a cloaking stealth ace and an orbital platform.
>
> - 18 stages · 5 worlds · 4 bosses · ~25 minutes a run
> - Arcade, weekly Score Attack and Practice
> - Replay-verified online leaderboards
> - Modern 3D or retro sprite-scaler look
> - Keyboard + mouse, gamepad or touch
>
> Free. No ads, no sign-up.

## Other portals

Poki and CrazyGames both require their ad SDK (rewarded/interstitial ads) in submitted games, which conflicts with the no-ads decision, so they're skipped. Portals that accept ad-free HTML5 uploads: itch.io, Newgrounds, GameJolt — the same zip works for all three (add each portal's game origin to `ALLOWED_ORIGIN`).
