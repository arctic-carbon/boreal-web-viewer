# Local Imagery Serving Design

**Date:** 2026-09-30  
**Branch:** denali-data  
**Scope:** Local development only

## Goal

Swap all data sources from `source.coop` URLs to locally-hosted COG files in
`/Users/sludwig/Documents/Python/viz/`, without touching checked-in source
files for the serving configuration.

## Non-goals

- Production deployment of local files
- COG conversion (done separately with GDAL outside this project)
- Reprojection of `fire_risk_denali.tif` from Alaska Albers to WGS84 (done
  as part of COG conversion)
- Float32 / Byte render pipeline support (Phase 2, separate plan)

## Local file inventory

| File | Data type | Bands | Replaces / new |
|---|---|---|---|
| `AGC_hist_denali.tif` | UInt16 | 1 | replaces `AGC_historical` |
| `AGC_ssp585_denali.tif` | UInt16 | 1 | replaces `AGC_ssp585` |
| `BGC_hist_denali.tif` | UInt16 | 1 | replaces `BGC_historical` |
| `BGC_ssp585_denali.tif` | UInt16 | 1 | replaces `BGC_ssp585` |
| `fire_risk_denali.tif` | Float32 | 6 | new layer |
| `landcover_denali.tif` | Byte | 2 | new layer |

All files are in `/Users/sludwig/Documents/Python/viz/`. They must be
converted to Cloud-Optimized GeoTIFFs (COGs) and reprojected to WGS84
(EPSG:4326) before use. That step is outside this plan.

## Architecture

### Serving

No npm script is added (the serve path is machine-specific). Before running
`pnpm dev`, start a CORS-enabled static file server in a separate terminal:

```bash
npx serve --cors /Users/sludwig/Documents/Python/viz -l 8080
```

Files are then accessible at `http://localhost:8080/<filename>`.

### Environment variable

Create `.env.local` in the project root (already gitignored by Vite):

```
VITE_DATA_BASE_URL=http://localhost:8080
```

When this variable is absent (CI, production), `sources.ts` falls back to the
source.coop base URL automatically.

## Code changes

### `src/sources.ts`

**1. Base URL reads env var with fallback:**

```typescript
const BASE = import.meta.env.VITE_DATA_BASE_URL
  ?? "https://data.source.coop/luddaludwig/boreal-fire-carbon";
```

**2. `LayerSource` type gains `dataType`:**

```typescript
export type LayerSource = {
  id: string;
  url: string;
  title: string;
  dataMin: number;
  dataMax: number;
  units: string;
  displayScale: number;
  dataType: "uint16" | "float32" | "byte";
};
```

**3. `SOURCES` array replaced entirely:**

Removed: `AGC_ssp126`, `BGC_ssp126`, `Depth_ssp585`, `Depth_ssp126`,
`BGC_historical`, `AGC_historical` (superseded by denali-specific files).

New entries:

```typescript
export const SOURCES: LayerSource[] = [
  {
    id: "AGC_hist",
    url: `${BASE}/AGC_hist_denali.tif`,
    title: "Above-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 72,      // from original source — verify against local file
    dataMax: 3281,
    dataType: "uint16",
  },
  {
    id: "AGC_ssp585",
    url: `${BASE}/AGC_ssp585_denali.tif`,
    title: "Above-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 95,
    dataMax: 3295,
    dataType: "uint16",
  },
  {
    id: "BGC_hist",
    url: `${BASE}/BGC_hist_denali.tif`,
    title: "Below-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 985,
    dataMax: 5762,
    dataType: "uint16",
  },
  {
    id: "BGC_ssp585",
    url: `${BASE}/BGC_ssp585_denali.tif`,
    title: "Below-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1079,
    dataMax: 5645,
    dataType: "uint16",
  },
  {
    id: "fire_risk",
    url: `${BASE}/fire_risk_denali.tif`,
    title: "Fire risk",
    units: "",          // TODO: fill in correct units
    displayScale: 1,
    dataMin: 0,         // TODO: fill in from gdalinfo
    dataMax: 1,         // TODO: fill in from gdalinfo
    dataType: "float32",
  },
  {
    id: "landcover",
    url: `${BASE}/landcover_denali.tif`,
    title: "Land cover",
    units: "",          // TODO: fill in correct units
    displayScale: 1,
    dataMin: 0,         // TODO: fill in from gdalinfo
    dataMax: 255,       // Byte max; may be a class count
    dataType: "byte",
  },
];
```

### `CLAUDE.md`

Add a "Local development with local imagery" section documenting the
`.env.local` setup and the `npx serve` command.

### `vite-env.d.ts` (or `src/env.d.ts`)

Extend the `ImportMetaEnv` interface to declare the custom variable:

```typescript
interface ImportMetaEnv {
  readonly VITE_DATA_BASE_URL?: string;
}
```

### No other files change in Phase 1

`App.tsx`, `useLayerState.ts`, `LayerPanel.tsx` are unchanged. The `dataType`
field is added to the type and stored on each source but not yet consumed by
the render pipeline.

## Render pipeline compatibility

| Layer | Phase 1 | Notes |
|---|---|---|
| AGC / BGC (uint16) | Works correctly | Existing pipeline unchanged |
| fire_risk (float32) | Renders incorrectly | Shader decodes as UInt16; acceptable for now |
| landcover (byte) | Renders incorrectly | Same reason |

**Phase 2 (separate plan):** Add a `RescaleFloat32` shader module and select
the appropriate module in `buildCOGLayer` based on `source.dataType`. The
existing `Rescale` module stays unchanged for `uint16` layers. Nodata handling
also changes: Float32 uses `isnan(color.r)` instead of `rawValue == 0.0`.

## Open items before implementation

- Verify `dataMin`/`dataMax` for all four UInt16 denali files (`AGC_hist`,
  `AGC_ssp585`, `BGC_hist`, `BGC_ssp585`) with `gdalinfo -mm` — the
  pan-boreal ranges in the current `sources.ts` may not apply to the Denali
  subset.
- Fill in `units`, `dataMin`, `dataMax` for `fire_risk` and `landcover`.
- Confirm COG + WGS84 reprojection is complete for all six files before
  testing the serve setup.
