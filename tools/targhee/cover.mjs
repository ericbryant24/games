/* Tree cover from ESA WorldCover 2021 (10 m, public on AWS). Class 10 is tree cover;
   ski runs, meadows and rock show up as everything else. */
import { fromUrl } from 'geotiff';

const URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N42W111_Map.tif';

export async function treeCover(latMin, latMax, lonMin, lonMax) {
  const tiff = await fromUrl(URL);
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const x0 = Math.floor((lonMin - ox) / rx), x1 = Math.ceil((lonMax - ox) / rx);
  const y0 = Math.floor((latMax - oy) / ry), y1 = Math.ceil((latMin - oy) / ry);
  const [data] = await img.readRasters({ window: [x0, y0, x1, y1] });
  const w = x1 - x0, h = y1 - y0;
  // Returns the WorldCover class at a lat/lon (nearest pixel).
  return (lat, lon) => {
    const x = Math.floor((lon - ox) / rx) - x0, y = Math.floor((lat - oy) / ry) - y0;
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    return data[y * w + x];
  };
}
