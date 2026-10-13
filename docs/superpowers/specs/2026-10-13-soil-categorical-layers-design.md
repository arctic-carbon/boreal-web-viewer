# Soil Categorical Layers Design

**Date:** 2026-10-13  
**Branch:** soil_layers

---

## Goal

Add three new categorical raster layers to the boreal-web-viewer derived from the `soilmu_a_ak651` NRCS soils shapefile:

- **Lithology** — 10 categories (e.g., "bedrock-acid igneous", "unconsolidated-drift")
- **Soil Parent Material** (`Soil_Paren`) — 16 categories (e.g., "colluvium-schist", "drift-mixed")
- **Soil Temperature Regime** (`Soil_Tempe`) — 6 categories (e.g., "cryic", "pergelic-permafrost")

All three are string-valued polygon attributes in the shapefile. The viewer renders them identically to the existing `landcover` layer: `byte` COG → `r8unorm` GPU texture → `CategoricalByte` shader → palette colormap. No changes to the rendering pipeline are needed.

---

## Source Data

| Item | Value |
|------|-------|
| Shapefile | `/Users/sludwig/Documents/Python/viz/soilmu_a_ak651.shp` |
| Shapefile CRS | EPSG:3338 (Alaska Albers) |
| Feature count | 3,466 polygons |
| Target CRS | EPSG:4326 (WGS84) — matches all existing COGs |
| Reference raster | `/Users/sludwig/Documents/Python/viz/landcover_denali.tif` |
| Reference extent | xmin=−153.4333, ymin=61.9744, xmax=−148.0631, ymax=64.3433 |
| Reference pixel size | ~0.000421° (~37 m at this latitude) |
| Reference size | 12,742 × 5,621 pixels |

Unique values per field (from DBF scan):

**Lithology (10):** bedrock-acid igneous, bedrock-dark sedimentary, bedrock-mixed, bedrock-schist, unconsolidated-Nenana Gravels, unconsolidated-alluvium, unconsolidated-colluvium, unconsolidated-drift, unconsolidated-eolian, water

**Soil_Paren (16):** alluvium-acid igneous, alluvium-mixed, alluvium-schist, ash & colluvium, ash over till, colluvium-acid igneous, colluvium-dark sedimentary, colluvium-mica rich, colluvium-mixed, colluvium-schist, drift-Nenana Gravels, drift-acid igneous, drift-mixed, eolian, eolian-mica rich, water

**Soil_Tempe (6):** cryic, cryic & pergelic-permafrost, pergelic-nonpermafrost, pergelic-permafrost, pergelic-permafrost & nonpermafrost, water

---

## Part 1 — Preprocessing Script

**Location:** `scripts/rasterize_soils.py`

**Dependencies:** Python 3 + `osgeo` (GDAL Python bindings) — already present in the project environment.

**Algorithm (repeated for each of the three fields):**

1. Open `soilmu_a_ak651.shp` with `osgeo.ogr`.
2. Collect all unique non-empty string values for the target field. Sort alphabetically. Assign integer codes **1–N** in that order. Code **0** is reserved for nodata (pixels outside all polygons). "water" gets a non-zero code and is displayed with its own color — it is legitimate survey data, not nodata.
3. Build an in-memory OGR layer reprojected to EPSG:4326. Add an integer field `_code` to each feature set to its code from step 2.
4. Call `gdal_rasterize` (Python bindings) targeting the exact extent and pixel size of `landcover_denali.tif`. Output format: GeoTIFF, `Byte` data type, `INIT=0` (default fill), burn attribute `_code`.
5. Build reduced-resolution overviews (levels 2, 4, 8, 16, 32).
6. Translate to COG profile: `COMPRESS=DEFLATE`, `TILED=YES`, `BLOCKXSIZE=512`, `BLOCKYSIZE=512`, `COPY_SRC_OVERVIEWS=YES`.
7. Print the palette mapping `{code: (label, suggested_rgb)}` to stdout for review before adding to `sources.ts`.

**Output files** (written to `/Users/sludwig/Documents/Python/viz/`):
- `lithology_denali.tif`
- `soil_paren_denali.tif`
- `soil_tempe_denali.tif`

**Color assignment:** The script generates suggested colors using a Glasbey-style palette (same approach as `LANDCOVER_PALETTE`). Colors are reviewed and adjusted in `sources.ts` before deployment; the script output is a starting point, not the final palette.

---

## Part 2 — Viewer Changes

**File:** `src/sources.ts` only. No other files change.

### New palette constants

Three new `LandcoverClass[]` constants added above `SOURCES`:

```ts
const LITHOLOGY_PALETTE: LandcoverClass[] = [
  { value: 1, label: "bedrock-acid igneous",         color: [/* TBD from script */] },
  { value: 2, label: "bedrock-dark sedimentary",     color: [...] },
  // ... 10 entries total
];

const SOIL_PAREN_PALETTE: LandcoverClass[] = [
  // ... 16 entries
];

const SOIL_TEMPE_PALETTE: LandcoverClass[] = [
  // ... 6 entries
];
```

Colors are filled in from the script's printed output, then reviewed for perceptual distinctness and colorblind accessibility.

### New SOURCES entries

Three entries appended to the `SOURCES` array:

```ts
{
  id: "lithology",
  url: `${BASE}/lithology_denali.tif`,
  title: "Lithology",
  units: "",
  displayScale: 1,
  dataMin: 0,
  dataMax: 10,
  dataType: "byte",
  singleBand: true,
  hideRangeControls: true,
  palette: LITHOLOGY_PALETTE,
},
{
  id: "soil_paren",
  url: `${BASE}/soil_paren_denali.tif`,
  title: "Soil Parent Material",
  units: "",
  displayScale: 1,
  dataMin: 0,
  dataMax: 16,
  dataType: "byte",
  singleBand: true,
  hideRangeControls: true,
  palette: SOIL_PAREN_PALETTE,
},
{
  id: "soil_tempe",
  url: `${BASE}/soil_tempe_denali.tif`,
  title: "Soil Temperature Regime",
  units: "",
  displayScale: 1,
  dataMin: 0,
  dataMax: 6,
  dataType: "byte",
  singleBand: true,
  hideRangeControls: true,
  palette: SOIL_TEMPE_PALETTE,
},
```

---

## What Does NOT Change

| Component | Reason |
|-----------|--------|
| `App.tsx` | `CategoricalByte` shader and `r8unorm` texture path already handle byte categorical layers |
| `useLayerState.ts` | No changes needed; `dataType: "byte"` + `palette` already fully supported |
| Click-to-inspect UI | Already reads `palette.find(c => c.value === clickInfo.value)?.label` (App.tsx ~line 409) |
| Rendering pipeline | Byte COG → `r8unorm` → `CategoricalByte` → palette colormap is the existing landcover path |

---

## Deployment

After local verification:
1. Upload the three new COGs to source.coop under the existing `luddaludwig/denali-fire-risk` dataset path.
2. Confirm URLs match the `${BASE}/...` pattern in sources.ts.
3. Remove `.env.local` (or leave it; sources.ts falls back to source.coop automatically when `VITE_DATA_BASE_URL` is absent).

---

## Out of Scope

- Adjusting colors beyond the initial Glasbey suggestion (iterative; can be done anytime by editing the palette constants).
- Adding a legend panel to the UI for categorical layers (existing click-to-inspect covers the immediate need).
- Uploading to source.coop (manual step, not part of the implementation plan).
