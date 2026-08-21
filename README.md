# Deck Chair Arcade

A small arcade of browser games, served as static files from GitHub Pages. No build
step, no bundler, no dependencies to install — plain HTML, CSS and ES modules, plus one
vendored copy of three.js. Open `index.html` and it works.

**Play: https://ericbryant24.github.io/games/**

## Games

### Windward — `games/sailing/`

A keelboat racing simulator. One lap of a windward–leeward course against four computer
skippers, portrait-first, with the helm on your left thumb and the mainsheet on your
right.

It tries to be an honest simulation rather than a boat-shaped arcade game:

- **Sail aerodynamics.** Lift and drag through and past stall, resolved against the
  apparent wind. You cannot sail closer than about 40° to the true wind, running dead
  square is slow because the main blankets the headsail, and the boat is drag-driven
  rather than lift-driven once the wind is behind the beam.
- **Apparent wind.** Speed shifts the wind forward, which is why the boat accelerates
  into its own breeze on a reach and why the numbers on the dial move as you go faster.
- **Keel and rudder as foils.** Sailing upwind means slipping sideways a few degrees so
  the keel can generate the side force that balances the rig. Slip too much and the
  keel stalls; the hull straightens the flow before it reaches the rudder, so a boat
  crabbing badly loses its steering.
- **Helm balance.** The rig's centre of effort sits forward of the hull's centre of
  lateral resistance, so a stopped boat bears away by itself. Heel walks the balance
  point aft and turns that into the weather helm you lean against upwind — and a roll
  to windward does the opposite and makes the boat bear away.
- **A boom that stays where it is.** The sail keeps its side until the wind is properly
  across the other way. That is what makes a gybe an event, what stops a lazy tack, and
  what lets you back the sail and steer out of irons instead of sitting there.
- **Righting moment.** Ballast plus the form stability of a beamy hull plus the crew on
  the rail. Over about 20 knots the boat reefs, because a 7 m boat carrying full sail in
  25 knots is not a racing boat, it is a recovery exercise.
- **Waves that the hull actually rides.** A Gerstner spectrum scaled to the wind, short
  and steep the way fetch-limited inshore water is. The same wave field drives the
  vertex shader and the physics, and the hull only responds to waves longer than it is.
- **Wind that is not uniform.** Oscillating shifts, gust cells drifting downwind, and
  the wind shadow every boat throws behind it — so sitting on someone's transom costs
  you real speed.

Racing rules: you have to start between the marks after the gun (over early and you owe
the line a return), and you have to round each mark rather than cut the corner.

## Layout

```
index.html            the arcade; add a game by adding an entry to assets/site.js
assets/               landing page styles, the game registry
games/sailing/
  index.html          menu, HUD canvas, thumb pads
  style.css
  src/
    water.js          Gerstner wave field, shared by the physics and the shaders
    wind.js           shifts, gusts and wind shadows
    physics.js        hull, rig, foils, righting moment — the simulation
    course.js         course geometry, the start sequence, mark roundings, standings
    ai.js             computer skippers
    sim.js            the whole world, headless: no reference to anything visible
    input.js          two-thumb controls, and the keyboard
    hud.js            instruments, drawn on a 2D canvas
    main.js           menu, race loop, results
    render/           sky, ocean, boat model, wake, marks, camera
  vendor/             three.js r160 (MIT), vendored so nothing loads off a CDN
tools/                headless test harnesses — see tools/README.md
```

`sim.js` deliberately knows nothing about rendering, which is what lets the whole race
run headless in `tools/race.mjs` and the boat's polar be measured in `tools/polar.mjs`.
Run both after touching the physics.

## Running it locally

ES modules need to be served over HTTP rather than opened as files:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Publishing

GitHub Pages, serving the repository root from the default branch — Settings → Pages →
Deploy from a branch → `main` / `/ (root)`. The `.nojekyll` file at the root stops
Jekyll from touching anything.

## Licence

MIT, see `LICENSE`. three.js is MIT too, and its licence header is intact at the top of
`games/sailing/vendor/three.module.min.js`.
