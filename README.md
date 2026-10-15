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

### Copycats — `games/ski/`

An endless downhill chase on a mountain generated fresh every run. You pick who you are —
Eric, Brent or Tyler on skis, or Trevor on a board — and the other three come after you.
They follow your line, copy your jumps and have to copy your tricks. Make all three crash
and you win; the score is how long it took. Crash yourself and they win.

- **They copy you, imperfectly.** Each chaser follows the breadcrumb trail of your line,
  aiming a little way ahead along it — so they cut your corners. Skim a tree and the
  ones who cut hardest clip it. They spot obstacles and swerve, if they are quick enough.
- **Random abilities.** Every run rolls each chaser five abilities — landings, line,
  eyes, tricks, carving — with one clear weakness and one clear strength each, shown on
  the roster during the countdown. Find the weakness and use it.
- **Tricks they must match.** Spin and flip in the air; whoever takes off where you did
  has to do the same rotation. A slow spinner who comes up short lands sideways.
- **Real enough physics.** Gravity along the slope, edges that carve up to their grip and
  skid off the rest, drag, and a rider who leaves the snow when it curves away faster
  than gravity can hold them — off cliff bands, kickers, rollers and moguls. Landings
  are judged on speed into the slope and on how square your skis are.
- **Endless terrain.** A meandering run between forest walls, built a segment at a time
  from a seed: cliff bands with rollovers either side, kickers with a dye line on the lip,
  rollers, mogul fields, tree islands, gates of trees to thread and rock gardens.
- **Camera facing you** by default, Grand Mountain Adventure style: you ski towards the
  lens, so the faces of drops and jumps are in view and the chasers are above you on
  screen. A behind-you camera is in the menu.

Controls: drag anywhere to carve, drag down to tuck, up to brake, tap (or tap a second
finger) to jump. In the air the same drags spin and flip you. Keyboard: arrows/WASD
and space.

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
games/ski/
  src/
    terrain.js        the endless mountain: heights, features, trees and rocks
    skier.js          one rider's physics — carving, skidding, air, landings
    sim.js            the chase, headless: your line, the chasers' brains, the rules
    input.js          one-thumb drag controls, and the keyboard
    hud.js            clock, chasers, name tags, messages
    main.js           menu, character picker, countdown, results, scoreboard
    render/           mountain chunks, riders, ski tracks, snow spray, camera
  vendor/             three.js r160 again, so each game stands alone
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
