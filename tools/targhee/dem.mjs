/* Elevation from the public AWS Terrain Tiles (Terrarium encoding; in the US the source
   is USGS 3DEP at about 10 m). Tiles are cached on disk so a rebuild does not refetch. */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const CACHE = process.env.TARGHEE_CACHE || path.join(process.cwd(), '.cache');

export function lonToX(lon, z) { return (lon + 180) / 360 * 2 ** z; }
export function latToY(lat, z) {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;
}
export function xToLon(x, z) { return x / 2 ** z * 360 - 180; }
export function yToLat(y, z) { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); }

async function tile(z, x, y) {
  const file = path.join(CACHE, `t${z}_${x}_${y}.png`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  const png = PNG.sync.read(fs.readFileSync(file));
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) {
    const d = png.data;
    h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  }
  return h;
}

/* A sampler for elevation at any lat/lon, bilinear between tile pixels. */
export async function elevation(z, latMin, latMax, lonMin, lonMax) {
  const x0 = Math.floor(lonToX(lonMin, z)), x1 = Math.floor(lonToX(lonMax, z));
  const y0 = Math.floor(latToY(latMax, z)), y1 = Math.floor(latToY(latMin, z));
  const tiles = new Map();
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.set(`${x},${y}`, await tile(z, x, y));
  const px = (X, Y) => {
    const tx = Math.floor(X / 256), ty = Math.floor(Y / 256);
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return NaN;
    return t[(Y - ty * 256) * 256 + (X - tx * 256)];
  };
  return (lat, lon) => {
    const X = lonToX(lon, z) * 256 - 0.5, Y = latToY(lat, z) * 256 - 0.5;
    const ix = Math.floor(X), iy = Math.floor(Y), fx = X - ix, fy = Y - iy;
    const a = px(ix, iy), b = px(ix + 1, iy), c = px(ix, iy + 1), d = px(ix + 1, iy + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}
