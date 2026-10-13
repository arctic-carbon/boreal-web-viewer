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
    """Print code->label mapping to stdout so you can verify order matches sources.ts."""
    print(f"\n// {field} code->label (verify these match the palette in sources.ts)")
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

        print(f"Rasterizing -> {cog_path} ...", end=" ", flush=True)
        rasterize_field(shp_ds, field, code_map, ref_ds, tmp_path)
        build_cog(tmp_path, cog_path)
        print("done")

        print_palette(field, code_map)

    print("\nAll done. Verify the code->label order above matches the palette constants in src/sources.ts.")


if __name__ == "__main__":
    main()
