# Boreal Web Viewer

Web visualization of geospatial data layers for boreal and arctic regions, rendered client-side from Cloud-Optimized GeoTIFFs using [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster).

## Website

https://arctic-carbon.github.io/boreal-web-viewer/

## Data Layers

High resolution maps of potential fire risk, carbon losses, and permafrost vulnerability to wildfire. These layers can be accessed at https://source.coop/luddaludwig/boreal-fire-carbon

- **Potential Above-Ground Combustion** — [Potential AGC in Boreal and Arctic North America for SSP585](https://source.coop/luddaludwig/boreal-fire-carbon/AGC_ssp585.tif) (note: this is not the final data product)
— [Potential AGC in Boreal and Arctic North America for SSP126](https://source.coop/luddaludwig/boreal-fire-carbon/AGC_ssp126.tif) (note: this is not the final data product)
— [Potential AGC in Boreal and Arctic North America for historical climate normals](https://source.coop/luddaludwig/boreal-fire-carbon/AGC_historical.tif) (note: this is not the final data product)

- **Potential Below-Ground Combustion** — [Potential BGC in Boreal and Arctic North America for SSP585](https://source.coop/luddaludwig/boreal-fire-carbon/BGC_ssp585.tif) (note: this is not the final data product)
— [Potential BGC in Boreal and Arctic North America for SSP126](https://source.coop/luddaludwig/boreal-fire-carbon/BGC_ssp126.tif) (note: this is not the final data product)
— [Potential BGC in Boreal and Arctic North America for historical climate normals](https://source.coop/luddaludwig/boreal-fire-carbon/BGC_historical.tif) (note: this is not the final data product)

- **Potential Burn Depth** — [Potential burn depth in Boreal and Arctic North America for SSP585](https://source.coop/luddaludwig/boreal-fire-carbon/Depth_ssp585.tif) (note: this is not the final data product)
— [Potential burn depth in Boreal and Arctic North America for SSP126](https://source.coop/luddaludwig/boreal-fire-carbon/Depth_ssp126.tif) (note: this is not the final data product)

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

