# Design: Multi-layer sources with per-layer units and value scale

**Date:** 2026-07-19
**Status:** Approved

## Goal

Expose all 8 .tif layers from the `luddaludwig/boreal-fire-carbon` source.coop repository in the dropdown. When the user selects a layer, the min/max sliders, slider labels, colormap units label, and click-popup value all automatically reflect that layer's data range and units.

## Layers

| id | title | units | displayScale | dataMin | dataMax |
|----|-------|-------|-------------|---------|---------|
| agc_ssp585 | Above-ground combustion SSP-585 | g-C/m² | 1 | 95 | 3295 |
| agc_ssp126 | Above-ground combustion SSP-126 | g-C/m² | 1 | 85 | 3297 |
| agc_historical | Above-ground combustion Historical | g-C/m² | 1 | 72 | 3281 |
| bgc_ssp585 | Below-ground combustion SSP-585 | g-C/m² | 1 | 1079 | 5645 |
| bgc_ssp126 | Below-ground combustion SSP-126 | g-C/m² | 1 | 1099 | 5539 |
| bgc_historical | Below-ground combustion Historical | g-C/m² | 1 | 985 | 5762 |
| depth_ssp585 | Burn depth SSP-585 | cm | 0.01 | 467 | 2111 |
| depth_ssp126 | Burn depth SSP-126 | cm | 0.01 | 491 | 2166 |

**URL pattern:** `https://data.source.coop/luddaludwig/boreal-fire-carbon/{ID}.tif`
where `{ID}` preserves original capitalisation (e.g. `AGC_ssp585`).

`dataMin`/`dataMax` are raw pixel values from `gdalinfo`. Zero is nodata — already discarded by the existing shader (`if (rawValue == 0.0) discard`).

Depth layers are stored as integers (cm × 100). `displayScale: 0.01` converts raw to cm for display. The shader receives raw values unchanged.

## Architecture

### New file: `src/sources.ts`

Exports:

```typescript
export type LayerSource = {
  id: string;
  url: string;
  title: string;
  dataMin: number;
  dataMax: number;
  units: string;
  displayScale: number;
};

export const SOURCES: LayerSource[];
```

All 8 entries as defined in the table above.

### Changes to `src/App.tsx`

**Config swap:**
- Remove `COG_OPTIONS` array, `DATA_MIN`, `DATA_MAX` constants.
- Import `SOURCES` and `LayerSource` from `./sources.ts`.
- Replace all `COG_OPTIONS[selectedIndex]` references with `SOURCES[selectedIndex]`.

**Auto-reset on layer change:**
- Initial state for `rangeMin`/`rangeMax` seeded from `SOURCES[0].dataMin` / `SOURCES[0].dataMax`.
- `useEffect` on `selectedIndex` resets both to the new layer's bounds.

**Slider bounds:**
- `min`/`max` attributes on both range inputs use `selected.dataMin` / `selected.dataMax`.

**Display formatting helper (inline):**
```typescript
function fmtVal(raw: number, src: LayerSource): string {
  return (raw * src.displayScale).toFixed(src.displayScale < 1 ? 2 : 0);
}
```

Used in: slider labels, click popup value, colormap legend range endpoints.

**Rescale shader fallback:**
- `getUniforms` fallback changes from `?? DATA_MIN / DATA_MAX` to `?? 0 / ?? 65535` (full raw range). Safe because explicit `rangeMin`/`rangeMax` are always passed from state.

### Panel UI

- Units label under colormap gradient: `{selected.units}` (was hardcoded `g‑C/m²`).
- Click popup: shows `fmtVal(value, selected) {selected.units}` (was raw integer).
- All other UI (gradient bar, basemap toggle, opacity slider, panel layout) unchanged.

## What is not in scope

- Rendering multiple layers simultaneously (future workstream).
- Dynamic range inference from COG metadata at load time.
- Colormap changes per layer type.
- Grouping the dropdown by variable type (AGC / BGC / Depth).