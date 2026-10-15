# Dev tools

`polar.mjs` runs the sailing physics headless and prints the boat's performance
polar — steady-state speed, VMG, heel, leeway and trim at every wind angle, for a
range of wind speeds. Run it after touching `games/sailing/src/physics.js` to check
you have not broken the boat.

```sh
cd tools && node polar.mjs
```

Sanity targets for the 7 m sportboat in 13.6 kn of true wind: best upwind VMG
around 42° TWA at roughly 5.4 kn of boat speed, 16-19° of heel and under 6° of
leeway; best downwind VMG near 150° TWA; heel should never exceed the low 20s
once the trim optimiser has settled, at any wind speed.

`race.mjs` sails a whole fleet round the course headless, with the player's boat
handed to the same autopilot as the rivals. Use it to check the skippers can
actually get round in a given breeze.

```sh
cd tools && node race.mjs 7 1     # wind in m/s, then laps
```

Everyone should finish. The fleet is reliable from about 5 to 16 m/s (10-31 kn);
below that it is drifting conditions and boats may time out, which is realistic
enough. A one-lap race takes roughly four and a half to nine minutes.

`ski.mjs` runs headless chases for Copycats with the player handed to a simple
autopilot, and reports who crashed, when and why.

```sh
cd tools && node ski.mjs 12 weave      # runs, then style: weave | lure | straight | tricks
VERBOSE=1 node ski.mjs 3 lure          # every big landing and every crash
```

The autopilot is no expert and crashes plenty itself; what to look for is the chasers
going down for reasons that follow from the line it took — clipped trees on tight
lines, hard landings off big air, botched copies of tricks — rather than at random.
