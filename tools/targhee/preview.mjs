/* A hillshade of the area with tree cover tinted green: a quick look at the data. */
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { elevation } from './dem.mjs';
import { treeCover } from './cover.mjs';
const [latMin, latMax, lonMin, lonMax] = [43.765, 43.805, -110.975, -110.905];
const h = await elevation(15, latMin, latMax, lonMin, lonMax);
const cov = await treeCover(latMin, latMax, lonMin, lonMax);
const W = 900, H = Math.round(W * (latMax - latMin) / ((lonMax - lonMin) * Math.cos(43.785 * Math.PI / 180)));
const png = new PNG({ width: W, height: H });
const mPerLon = 111320 * Math.cos(43.785 * Math.PI / 180), mPerLat = 110950;
const cell = (lonMax - lonMin) * mPerLon / W;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const lat = latMax - (j + 0.5) / H * (latMax - latMin), lon = lonMin + (i + 0.5) / W * (lonMax - lonMin);
  const e = h(lat, lon);
  const ex = (h(lat, lon + cell / mPerLon) - h(lat, lon - cell / mPerLon)) / (2 * cell);
  const ey = (h(lat + cell / mPerLat, lon) - h(lat - cell / mPerLat, lon)) / (2 * cell);
  const shade = Math.max(0, Math.min(1, 0.55 + (-ex * 0.7 + ey * 0.7) * 1.2));
  const c = cov(lat, lon);
  let r = 235, g = 240, b = 248;
  if (c === 10) { r = 40; g = 95; b = 60; }
  else if (c === 60 || c === 70) { r = 150; g = 145; b = 140; }
  const k = 0.35 + 0.65 * shade;
  const contour = Math.abs(((e / 30) % 1) - 0.5) > 0.47 ? 0.8 : 1;
  const o = (j * W + i) * 4;
  png.data[o] = r * k * contour; png.data[o + 1] = g * k * contour; png.data[o + 2] = b * k * contour; png.data[o + 3] = 255;
}
fs.writeFileSync(process.argv[2], PNG.sync.write(png));
console.log('wrote', W, 'x', H, 'cell', cell.toFixed(1), 'm');
