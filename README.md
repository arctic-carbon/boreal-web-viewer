# Boreal Web Viewer

Web visualization of geospatial data layers for boreal and arctic regions, rendered client-side from Cloud-Optimized GeoTIFFs using [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster).

## Website

https://arctic-carbon.github.io/boreal-web-viewer/

## Data Layers

- **Potential Above-Ground Combustion** — [Potential AGC in Boreal and Arctic North America for SSP585](https://source.coop/luddaludwig/potential-agc-combustion-ssp585-v0) (note: this is not the final data product)

Additional data layers will be added over time.

## Setup

```bash
git clone https://github.com/arctic-carbon/boreal-web-viewer.git
cd boreal-web-viewer
pnpm install
pnpm dev
```

Open http://localhost:3000.

## How it works

The app streams tiles directly from COGs hosted on [source.coop](https://source.coop), using a custom render pipeline:

1. Tiles are fetched via HTTP range requests and uploaded as `r16unorm` textures
2. A GPU shader rescales values to a user-adjustable min/max range
3. A viridis colormap is applied via texture lookup
4. Zero values are treated as nodata and discarded

