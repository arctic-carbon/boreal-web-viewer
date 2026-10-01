# Denali Fire and Carbon Risk Web Viewer

Web visualization of geospatial data layers for boreal and arctic regions, rendered client-side from Cloud-Optimized GeoTIFFs using [deck.gl-raster](https://github.com/developmentseed/deck.gl-raster).

## Website

https://arctic-carbon.github.io/denali-fire-risk/

## Data Layers

High resolution maps of potential fire risk, carbon losses, and permafrost vulnerability to wildfire. These layers can be accessed at https://source.coop/luddaludwig/denali-fire-risk (note: these are not the final data products)

Denali National Park infrastructure and landcover layers can be accessed at https://www.nps.gov/articles/irma.htm

Additional data layers will be added over time.

## Setup

```bash
git clone https://github.com/arctic-carbon/denali-fire-risk.git
cd denali-fire-risk
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

