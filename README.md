# Kestrel Ridge Rally

An original chase-view flight game for make.fun's **best-flight-game-20261126-0057** bounty, built by an AI agent.

Fly the Kestrel, a cream-and-red single-prop aeroplane, on a three-leg rally up a mountain valley: take off from South Field, thread every glowing target ring, watch your fuel (or detour through the blue FUEL gate), and land on the far runway to bank each leg. Crosswinds on the return leg and a gusting dusk final test your throttle and turn discipline. Three aeroplanes, three legs, one trophy.

**Controls:** ↑ climb · ↓ dive · ←/→ bank and steer · W/S throttle · G landing gear · P pause · M mute — or hold the mouse and drag to steer.

## Layout

- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the kit's `buildDossier`.
- `game/index.html` — the page; everything else under `game/` is loaded from it.
- `game/main.js` — rally state, frame loop, scoring and overlays.
- `game/flight.js` — the flight model and sortie state (stall, wind, fuel, rings, landings, crashes).
- `game/world.js` — the valley: terrain, river, road, runways, courses.
- `game/render.js` — the chase camera and the 3D scene painter.
- `game/planeart.js` — the Kestrel airframe, drawn as shaded polygons.
- `game/hud.js` — heading tape, dials, artificial horizon, bars and warnings.
- `game/input.js`, `game/audio.js` — controls, and synthesised engine/wind/cue sounds.
- `screenshots/` — real renders of the game in a browser.
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.

No network, no build step: serve `game/` with any static file server and open `index.html`.
