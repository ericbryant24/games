# Grand Targhee map data

Builds `games/ski/data/targhee.png` and `targhee.json`, the real mountain Copycats can be
played on, from two public sources:

- **Elevation:** [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
  (Terrarium encoding; in the US the source is USGS 3DEP at about 10 m), zoom 15.
- **Forest:** [ESA WorldCover 2021](https://esa-worldcover.org/) 10 m land cover; class 10,
  tree cover, becomes a feathered forest density.

```sh
cd tools/targhee
npm install
node build.mjs            # writes the two files into games/ski/data
node preview.mjs out.png  # hillshade with the forest tinted, to eyeball the data
node ride.mjs fred 4      # headless rides down from a named place, chasers and all
```

The map is 6.7 × 5.1 km on a 5 m grid around the resort, in metres from an origin at
43.785° N, 110.94° W (x east, z south). The PNG packs height above 2200 m in decimetres
into red and green, and forest density into blue. Named places (the two summits and the
base) are found in the elevation data itself.

Run names, difficulties and lift lines come from OpenStreetMap; the build will add them
when `overpass-api.de` is reachable.
