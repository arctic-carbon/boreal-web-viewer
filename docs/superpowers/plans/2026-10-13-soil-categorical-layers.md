# Soil Categorical Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rasterize three fields from `soilmu_a_ak651.shp` into byte COGs and register them as categorical layers in the viewer alongside the existing landcover layer.

**Architecture:** A standalone Python script (GDAL bindings) converts each shapefile field to integer codes, reprojects to EPSG:4326, rasterizes at landcover resolution, and outputs COG-profile GeoTIFFs. The viewer picks these up via three new `LayerSource` entries in `sources.ts` — no rendering-pipeline changes needed, since the byte categorical path (`CategoricalByte` shader + `r8unorm` texture) already works for landcover.

**Tech Stack:** Python 3 + `osgeo` (GDAL ≥ 3.x) for the script; TypeScript + existing `sources.ts` pattern for the viewer.

**Spec:** `docs/superpowers/specs/2026-10-13-soil-categorical-layers-design.md`

## Global Constraints

- Output COGs must match `landcover_denali.tif` exactly: 12,742 × 5,621 px, EPSG:4326, pixel size ~0.000421°, extent xmin=−153.4333 ymin=61.9744 xmax=−148.0631 ymax=64.3433.
- Integer code 0 = nodata (pixels outside all survey polygons). All 10/16/6 class values including "water" get non-zero codes.
- `dataType: "byte"`, `singleBand: true`, `hideRangeControls: true`, `palette` required on each new `LayerSource`.
- Run `pnpm check` (Biome lint + format) before committing any TypeScript changes.
- Never touch `App.tsx`, `useLayerState.ts`, or anything in the rendering pipeline.
- Shapefile is at `/Users/sludwig/Documents/Python/viz/soilmu_a_ak651.shp` (EPSG:3338). Reference raster is at `/Users/sludwig/Documents/Python/viz/landcover_denali.tif`.

## Review Focus

- **Null/empty field values in features** — features with a blank or null value for a field should be silently skipped (not burned), leaving those pixels at 0 (nodata). Verify at least one null-value feature exists in the data and is handled cleanly.
- **"water" category visibility** — "water" must receive a non-zero code (e.g., 10 for Lithology) and appear colored on the map. A common mistake is treating "water" as nodata because it has no soil properties. Verify `max_value >= expected_max_code` for each output.
- **Axis-order flip on reprojection** — GDAL 3+ defaults to EPSG axis order (lat/lon) for EPSG:4326, which flips coordinates. `SetAxisMappingStrategy(OAMS_TRADITIONAL_GIS_ORDER)` must be set on both source and target SRS. Verify output COG extent matches reference raster bounds within 0.001°.
- **Raster initialized before rasterize** — if `band.Fill(0)` is skipped, uninitialised memory shows as garbage values. Verify `min_value == 0` in the output (confirming at least some nodata pixels exist outside the survey polygon coverage).
- **Palette length matches class count** — if a palette constant in `sources.ts` has fewer entries than the actual max code, the missing codes render as black or corrupt. Verify palette entry count matches field unique-value count (10, 16, 6).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `scripts/rasterize_soils.py` | Full preprocessing pipeline: code assignment, reprojection, rasterize, COG build, palette print |
| Modify | `src/sources.ts` | Add `LITHOLOGY_PALETTE`, `SOIL_PAREN_PALETTE`, `SOIL_TEMPE_PALETTE` constants + 3 entries in `SOURCES` |

---

## Task 1: Rasterization Script

**Files:**
- Create: `scripts/rasterize_soils.py`

**Interfaces:**
- Produces: `/Users/sludwig/Documents/Python/viz/lithology_denali.tif`, `soil_paren_denali.tif`, `soil_tempe_denali.tif` (Byte COGs, EPSG:4326, 12742×5621)

- [ ] **Step 1: Create `scripts/` directory and write the script**

Create `scripts/rasterize_soils.py` with this exact content:

```python
#!/usr/bin/env python3
"""Rasterize soilmu_a_ak651.shp fields to byte COGs matching landcover_denali.tif."""

import json
import os
import sys

from osgeo import gdal, ogr, osr

gdal.UseExceptions()

SHP_PATH = "/Users/sludwig/Documents/Python/viz/soilmu_a_ak651.shp"
REF_PATH = "/Users/sludwig/Documents/Python/viz/landcover_denali.tif"
OUT_DIR = "/Users/sludwig/Documents/Python/viz"

FIELDS = {
    "Lithology": "lithology_denali.tif",
    "Soil_Paren": "soil_paren_denali.tif",
    "Soil_Tempe": "soil_tempe_denali.tif",
}


def get_unique_values(shp_ds: ogr.DataSource, field: str) -> list[str]:
    """Return sorted unique non-empty string values for field across all features."""
    layer = shp_ds.GetLayer()
    layer.ResetReading()
    values: set[str] = set()
    for feat in layer:
        val = feat.GetField(field)
        if val and val.strip():
            values.add(val.strip())
    layer.ResetReading()
    return sorted(values)


def build_code_map(values: list[str]) -> dict[str, int]:
    """Map each value to an integer code starting at 1. Code 0 is reserved for nodata."""
    return {v: i + 1 for i, v in enumerate(values)}


def rasterize_field(
    shp_ds: ogr.DataSource,
    field: str,
    code_map: dict[str, int],
    ref_ds: gdal.Dataset,
    tmp_path: str,
) -> None:
    """Write a Byte GeoTIFF with pixels set to the integer code for each polygon."""
    gt = ref_ds.GetGeoTransform()
    width = ref_ds.RasterXSize
    height = ref_ds.RasterYSize
    proj_wkt = ref_ds.GetProjection()

    # Create output raster, initialized to 0 (nodata)
    driver = gdal.GetDriverByName("GTiff")
    out_ds: gdal.Dataset = driver.Create(tmp_path, width, height, 1, gdal.GDT_Byte)
    out_ds.SetGeoTransform(gt)
    out_ds.SetProjection(proj_wkt)
    band = out_ds.GetRasterBand(1)
    band.Fill(0)
    band.SetNoDataValue(0)

    # Build target SRS (EPSG:4326, traditional lon/lat axis order)
    target_srs = osr.SpatialReference()
    target_srs.ImportFromEPSG(4326)
    target_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    # Build source SRS from shapefile, also traditional order
    src_layer = shp_ds.GetLayer()
    src_srs: osr.SpatialReference = src_layer.GetSpatialRef().Clone()
    src_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

    transform = osr.CoordinateTransformation(src_srs, target_srs)

    # Build in-memory layer reprojected to EPSG:4326 with integer _code attribute
    mem_driver = ogr.GetDriverByName("Memory")
    mem_ds: ogr.DataSource = mem_driver.CreateDataSource("mem")
    mem_layer: ogr.Layer = mem_ds.CreateLayer(
        "soil", srs=target_srs, geom_type=ogr.wkbMultiPolygon
    )
    mem_layer.CreateField(ogr.FieldDefn("_code", ogr.OFTInteger))
    defn = mem_layer.GetLayerDefn()

    src_layer.ResetReading()
    skipped = 0
    for feat in src_layer:
        val = feat.GetField(field)
        if not val or not val.strip():
            skipped += 1
            continue
        code = code_map.get(val.strip(), 0)
        if code == 0:
            skipped += 1
            continue
        geom: ogr.Geometry = feat.GetGeometryRef()
        if geom is None:
            skipped += 1
            continue
        geom = geom.Clone()
        if geom.Transform(transform) != 0:
            skipped += 1
            continue
        new_feat = ogr.Feature(defn)
        new_feat.SetGeometry(geom)
        new_feat.SetField("_code", code)
        mem_layer.CreateFeature(new_feat)

    if skipped:
        print(f"  ({skipped} features skipped: null/empty values or transform errors)")

    err = gdal.RasterizeLayer(out_ds, [1], mem_layer, options=["ATTRIBUTE=_code"])
    if err != 0:
        raise RuntimeError(f"gdal.RasterizeLayer failed with error code {err}")

    out_ds.FlushCache()
    out_ds = None
    mem_ds = None


def build_cog(tmp_path: str, cog_path: str) -> None:
    """Add overviews to tmp raster then translate to COG profile; remove tmp."""
    ds: gdal.Dataset = gdal.Open(tmp_path, gdal.GA_Update)
    ds.BuildOverviews("NEAREST", [2, 4, 8, 16, 32])
    ds = None

    gdal.Translate(
        cog_path,
        tmp_path,
        options=gdal.TranslateOptions(
            format="GTiff",
            creationOptions=[
                "COMPRESS=DEFLATE",
                "TILED=YES",
                "BLOCKXSIZE=512",
                "BLOCKYSIZE=512",
                "COPY_SRC_OVERVIEWS=YES",
                "BIGTIFF=NO",
            ],
        ),
    )
    os.remove(tmp_path)


def print_palette(field: str, code_map: dict[str, int]) -> None:
    """Print code→label mapping to stdout so you can verify order matches sources.ts."""
    print(f"\n// {field} code→label (verify these match the palette in sources.ts)")
    for label, code in sorted(code_map.items(), key=lambda x: x[1]):
        print(f"  {code}: {json.dumps(label)}")


def main() -> None:
    ref_ds: gdal.Dataset = gdal.Open(REF_PATH)
    if ref_ds is None:
        sys.exit(f"Cannot open reference raster: {REF_PATH}")

    shp_ds: ogr.DataSource = ogr.Open(SHP_PATH)
    if shp_ds is None:
        sys.exit(f"Cannot open shapefile: {SHP_PATH}")

    for field, out_name in FIELDS.items():
        values = get_unique_values(shp_ds, field)
        code_map = build_code_map(values)
        cog_path = os.path.join(OUT_DIR, out_name)
        tmp_path = os.path.join(OUT_DIR, f"_tmp_{out_name}")

        print(f"\n=== {field} ({len(values)} classes) ===")
        for label, code in sorted(code_map.items(), key=lambda x: x[1]):
            print(f"  {code}: {label!r}")

        print(f"Rasterizing → {cog_path} ...", end=" ", flush=True)
        rasterize_field(shp_ds, field, code_map, ref_ds, tmp_path)
        build_cog(tmp_path, cog_path)
        print("done")

        print_palette(field, code_map)

    print("\nAll done. Verify the code→label order above matches the palette constants in src/sources.ts.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script**

```bash
python3 scripts/rasterize_soils.py
```

Expected output (abbreviated):
```
=== Lithology (10 classes) ===
  1: 'bedrock-acid igneous'
  2: 'bedrock-dark sedimentary'
  ...
  10: 'water'
Rasterizing → /Users/sludwig/Documents/Python/viz/lithology_denali.tif ... done

=== Soil_Paren (16 classes) ===
  ...
Rasterizing → /Users/sludwig/Documents/Python/viz/soil_paren_denali.tif ... done

=== Soil_Tempe (6 classes) ===
  ...
Rasterizing → /Users/sludwig/Documents/Python/viz/soil_tempe_denali.tif ... done

All done. Copy the palette entries above into src/sources.ts.
```

If it fails with `ImportError: No module named 'osgeo'`, install GDAL: `pip3 install gdal` or `conda install gdal`.

- [ ] **Step 3: Verify the three COGs are correct**

Run:
```bash
python3 - <<'EOF'
from osgeo import gdal
gdal.UseExceptions()
checks = [
    ("lithology_denali.tif",  10),
    ("soil_paren_denali.tif", 16),
    ("soil_tempe_denali.tif",  6),
]
base = "/Users/sludwig/Documents/Python/viz"
all_ok = True
for name, expected_max in checks:
    ds = gdal.Open(f"{base}/{name}")
    assert ds is not None, f"Cannot open {name}"
    assert ds.RasterXSize == 12742 and ds.RasterYSize == 5621, \
        f"{name}: wrong size {ds.RasterXSize}x{ds.RasterYSize}"
    srs_wkt = ds.GetProjection()
    assert "4326" in srs_wkt, f"{name}: CRS is not EPSG:4326"
    band = ds.GetRasterBand(1)
    stats = band.GetStatistics(False, True)
    min_val, max_val = stats[0], stats[1]
    assert min_val == 0.0, f"{name}: min={min_val}, expected 0 (nodata pixels)"
    assert max_val == expected_max, f"{name}: max={max_val}, expected {expected_max}"
    print(f"OK  {name}: 12742x5621, EPSG:4326, min=0, max={int(max_val)}")
    ds = None
print("All checks passed.")
EOF
```

Expected:
```
OK  lithology_denali.tif:  12742x5621, EPSG:4326, min=0, max=10
OK  soil_paren_denali.tif: 12742x5621, EPSG:4326, min=0, max=16
OK  soil_tempe_denali.tif: 12742x5621, EPSG:4326, min=0, max=6
All checks passed.
```

- [ ] **Step 4: Confirm extent matches reference raster (axis-order check)**

```bash
python3 - <<'EOF'
from osgeo import gdal
gdal.UseExceptions()
ref = gdal.Open("/Users/sludwig/Documents/Python/viz/landcover_denali.tif")
new = gdal.Open("/Users/sludwig/Documents/Python/viz/lithology_denali.tif")
ref_gt = ref.GetGeoTransform()
new_gt = new.GetGeoTransform()
for i, (r, n) in enumerate(zip(ref_gt, new_gt)):
    diff = abs(r - n)
    assert diff < 1e-9, f"GeoTransform[{i}] mismatch: ref={r}, new={n}"
print(f"GeoTransforms match. Origin: lon={ref_gt[0]:.4f}, lat={ref_gt[3]:.4f}")
EOF
```

Expected: `GeoTransforms match. Origin: lon=-153.4333, lat=64.3433`

If the origin shows lat before lon (e.g., `lon=64.3333`), the axis-order fix (`OAMS_TRADITIONAL_GIS_ORDER`) did not apply correctly — revisit the `target_srs.SetAxisMappingStrategy` call in `rasterize_field`.

- [ ] **Step 5: Commit the script**

```bash
git add scripts/rasterize_soils.py
git commit -m "feat(scripts): add rasterize_soils.py to convert shapefile to byte COGs

Co-authored-by: Claude <noreply@anthropic.com>"
```

---

## Task 2: Palette Constants and SOURCES Entries

**Files:**
- Modify: `src/sources.ts` (add after line 54, before `export const SOURCES`)

**Interfaces:**
- Consumes: integer codes printed by Task 1's script (1-10 Lithology, 1-16 Soil_Paren, 1-6 Soil_Tempe)
- Consumes: `LandcoverClass` type already exported from `src/sources.ts:5`
- Produces: `SOURCES` array extended with 3 new entries, each with `palette`, `dataType: "byte"`, `singleBand: true`, `hideRangeControls: true`

- [ ] **Step 1: Add the three palette constants to `src/sources.ts`**

Insert the following block immediately after the closing `];` of `LANDCOVER_PALETTE` (after line 54) and before `export const SOURCES`:

```ts
// Lithology — codes 1–10 (alphabetical order from shapefile DBF)
const LITHOLOGY_PALETTE: LandcoverClass[] = [
  { value: 1,  label: "bedrock-acid igneous",          color: [168, 124,  90] },
  { value: 2,  label: "bedrock-dark sedimentary",      color: [ 80,  80,  90] },
  { value: 3,  label: "bedrock-mixed",                 color: [140, 130, 120] },
  { value: 4,  label: "bedrock-schist",                color: [110, 130,  90] },
  { value: 5,  label: "unconsolidated-Nenana Gravels", color: [200, 175, 120] },
  { value: 6,  label: "unconsolidated-alluvium",       color: [220, 200, 130] },
  { value: 7,  label: "unconsolidated-colluvium",      color: [190, 150,  90] },
  { value: 8,  label: "unconsolidated-drift",          color: [210, 190, 150] },
  { value: 9,  label: "unconsolidated-eolian",         color: [240, 225, 160] },
  { value: 10, label: "water",                         color: [ 70, 130, 180] },
];

// Soil Parent Material — codes 1–16 (alphabetical order from shapefile DBF)
const SOIL_PAREN_PALETTE: LandcoverClass[] = [
  { value: 1,  label: "alluvium-acid igneous",    color: [255,   0,   0] },
  { value: 2,  label: "alluvium-mixed",           color: [  0,   0, 255] },
  { value: 3,  label: "alluvium-schist",          color: [  0, 200,   0] },
  { value: 4,  label: "ash & colluvium",          color: [200,   0, 255] },
  { value: 5,  label: "ash over till",            color: [255, 150,   0] },
  { value: 6,  label: "colluvium-acid igneous",   color: [  0, 220, 220] },
  { value: 7,  label: "colluvium-dark sedimentary", color: [255,   0, 200] },
  { value: 8,  label: "colluvium-mica rich",      color: [220, 200,   0] },
  { value: 9,  label: "colluvium-mixed",          color: [  0,  80, 160] },
  { value: 10, label: "colluvium-schist",         color: [  0, 160,  80] },
  { value: 11, label: "drift-Nenana Gravels",     color: [120,   0,  80] },
  { value: 12, label: "drift-acid igneous",       color: [ 80, 220,   0] },
  { value: 13, label: "drift-mixed",              color: [200, 160, 120] },
  { value: 14, label: "eolian",                   color: [  0, 100,  50] },
  { value: 15, label: "eolian-mica rich",         color: [  0,  30, 200] },
  { value: 16, label: "water",                    color: [ 70, 130, 180] },
];

// Soil Temperature Regime — codes 1–6 (alphabetical order from shapefile DBF)
const SOIL_TEMPE_PALETTE: LandcoverClass[] = [
  { value: 1, label: "cryic",                              color: [100, 200, 255] },
  { value: 2, label: "cryic & pergelic-permafrost",        color: [  0, 100, 220] },
  { value: 3, label: "pergelic-nonpermafrost",             color: [  0, 200, 170] },
  { value: 4, label: "pergelic-permafrost",                color: [  0,   0, 200] },
  { value: 5, label: "pergelic-permafrost & nonpermafrost", color: [130,   0, 200] },
  { value: 6, label: "water",                              color: [ 70, 130, 180] },
];
```

- [ ] **Step 2: Append three new entries to the `SOURCES` array in `src/sources.ts`**

Add the following three objects inside the `SOURCES` array, after the closing `}` of the `"landcover"` entry and before the closing `];`:

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

- [ ] **Step 3: Run Biome check**

```bash
cd /Users/sludwig/Documents/Python/denali-fire-risk && pnpm check
```

Expected: no errors. If Biome reports formatting issues, run `pnpm check:fix` and re-run `pnpm check`.

- [ ] **Step 4: Verify palette entry counts match class counts**

```bash
node --input-type=module <<'EOF'
import { SOURCES } from './src/sources.ts';
const expected = { lithology: 10, soil_paren: 16, soil_tempe: 6 };
for (const [id, count] of Object.entries(expected)) {
  const src = SOURCES.find(s => s.id === id);
  if (!src) throw new Error(`Source "${id}" not found in SOURCES`);
  if (!src.palette) throw new Error(`Source "${id}" has no palette`);
  if (src.palette.length !== count) throw new Error(`"${id}" palette has ${src.palette.length} entries, expected ${count}`);
  console.log(`OK  ${id}: ${src.palette.length} entries`);
}
EOF
```

Expected:
```
OK  lithology: 10 entries
OK  soil_paren: 16 entries
OK  soil_tempe: 6 entries
```

If Node can't import TypeScript directly (likely), use this alternative:
```bash
python3 -c "
import re, sys
text = open('src/sources.ts').read()
for name, expected in [('LITHOLOGY_PALETTE', 10), ('SOIL_PAREN_PALETTE', 16), ('SOIL_TEMPE_PALETTE', 6)]:
    count = len(re.findall(r'value:\s*\d+', text.split(name)[1].split('];')[0]))
    status = 'OK' if count == expected else 'FAIL'
    print(f'{status}  {name}: {count} entries (expected {expected})')
"
```

- [ ] **Step 5: Start local dev server and visually verify all three layers**

Prerequisite: the CORS file server must be running in a separate terminal pointing to `/Users/sludwig/Documents/Python/viz` (see CLAUDE.md "Local development with local imagery"). If not already running:
```bash
npx serve --cors /Users/sludwig/Documents/Python/viz -l 8080
```

Ensure `.env.local` contains:
```
VITE_DATA_BASE_URL=http://localhost:8080
```

Start the dev server:
```bash
pnpm dev
```

Open http://localhost:3000. Check:
1. Layer selector shows "Lithology", "Soil Parent Material", "Soil Temperature Regime" as new options.
2. Selecting each layer renders colored polygons over the Denali area (not a blank/black map).
3. Clicking on a colored pixel shows the correct category label in the inspect panel (e.g., "bedrock-schist", not a number).
4. Pixels outside the survey area are transparent (nodata = 0).
5. "water" polygons render with steel-blue color `[70, 130, 180]`, not transparent.

- [ ] **Step 6: Commit sources.ts changes**

```bash
git add src/sources.ts
git commit -m "feat(sources): add Lithology, Soil Parent Material, Soil Temperature Regime layers

Co-authored-by: Claude <noreply@anthropic.com>"
```
