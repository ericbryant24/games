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
