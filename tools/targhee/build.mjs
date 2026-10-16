/* Builds the Grand Targhee map for Copycats:

     games/ski/data/targhee.png    the terrain, packed into an image:
                                   red, green  height above 2200 m in decimetres (hi, lo byte)
                                   blue        forest density, 0 open .. 255 thick timber
     games/ski/data/targhee.json   the grid's size, scale and origin, and named places

   Sources, both public: AWS Terrain Tiles (USGS 3DEP elevation, ~10 m) and ESA
   WorldCover 2021 land cover (10 m). Run from this folder:

     npm install && node build.mjs */

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { elevation } from './dem.mjs';
import { treeCover } from './cover.mjs';

const OUT = path.resolve(process.cwd(), '../../games/ski/data');
const BOX = { latMin: 43.762, latMax: 43.808, lonMin: -110.985, lonMax: -110.902 };
const ORIGIN = { lat: 43.785, lon: -110.94 };          // local x east, z south, metres
const CELL = 5;
const BASE_H = 2200;

const mPerLat = 110950, mPerLon = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
const toLocal = (lat, lon) => ({ x: (lon - ORIGIN.lon) * mPerLon, z: -(lat - ORIGIN.lat) * mPerLat });
const toLatLon = (x, z) => ({ lat: ORIGIN.lat - z / mPerLat, lon: ORIGIN.lon + x / mPerLon });

const a = toLocal(BOX.latMax, BOX.lonMin), b = toLocal(BOX.latMin, BOX.lonMax);
const x0 = Math.ceil(a.x / CELL) * CELL, z0 = Math.ceil(a.z / CELL) * CELL;
const W = Math.floor((b.x - x0) / CELL), H = Math.floor((b.z - z0) / CELL);
console.log(`grid ${W} x ${H} at ${CELL} m = ${(W * CELL / 1000).toFixed(1)} x ${(H * CELL / 1000).toFixed(1)} km`);

const dem = await elevation(15, BOX.latMin, BOX.latMax, BOX.lonMin, BOX.lonMax);
const cov = await treeCover(BOX.latMin, BOX.latMax, BOX.lonMin, BOX.lonMax);

const heights = new Float32Array(W * H), tree = new Float32Array(W * H);
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const { lat, lon } = toLatLon(x0 + i * CELL, z0 + j * CELL);
    heights[j * W + i] = dem(lat, lon);
    tree[j * W + i] = cov(lat, lon) === 10 ? 1 : 0;
  }
}
// Soften the 10 m land-cover pixels into a density, so forest edges feather.
const blur = (src, r) => {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const ii = i + k; if (ii >= 0 && ii < W) { s += src[j * W + ii]; n++; } }
    tmp[j * W + i] = s / n;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const jj = j + k; if (jj >= 0 && jj < H) { s += tmp[jj * W + i]; n++; } }
    out[j * W + i] = s / n;
  }
  return out;
};
const dens = blur(tree, 2);

const png = new PNG({ width: W, height: H, colorType: 2 });
for (let k = 0; k < W * H; k++) {
  const q = Math.max(0, Math.min(65535, Math.round((heights[k] - BASE_H) * 10)));
  png.data[k * 4] = q >> 8;
  png.data[k * 4 + 1] = q & 255;
  png.data[k * 4 + 2] = Math.round(dens[k] * 255);
  png.data[k * 4 + 3] = 255;
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'targhee.png'), PNG.sync.write(png, { colorType: 2, filterType: 4, deflateLevel: 9 }));

// Named places found in the elevation data itself: the two summits are the highest
// points of their massifs; the base is the low point of the base-area bowl.
const findPeak = (lat, lon, rad) => {
  let best = null;
  const c = toLocal(lat, lon);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = x0 + i * CELL, z = z0 + j * CELL;
    if (Math.hypot(x - c.x, z - c.z) > rad) continue;
    const h = heights[j * W + i];
    if (!best || h > best.h) best = { x, z, h };
  }
  return best;
};
const fred = findPeak(43.7776, -110.9232, 300);
const peaked = findPeak(43.7864, -110.9336, 300);
const base = toLocal(43.7871, -110.9581);
const meta = {
  name: 'Grand Targhee', origin: ORIGIN, cell: CELL, x0, z0, width: W, height: H, baseHeight: BASE_H,
  sources: ['AWS Terrain Tiles (USGS 3DEP elevation)', 'ESA WorldCover 2021 (10 m land cover)'],
  places: {
    fred: { name: "Fred's Mountain summit", x: fred.x, z: fred.z, elevation: Math.round(fred.h) },
    peaked: { name: 'Peaked Mountain summit', x: peaked.x, z: peaked.z, elevation: Math.round(peaked.h) },
    base: { name: 'Base area', x: Math.round(base.x), z: Math.round(base.z), elevation: Math.round(dem(43.7871, -110.9581)) }
  }
};
fs.writeFileSync(path.join(OUT, 'targhee.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(meta.places, 'png', (fs.statSync(path.join(OUT, 'targhee.png')).size / 1e6).toFixed(2), 'MB');
