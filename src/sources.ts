const BASE =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://data.source.coop/luddaludwig/denali-fire-risk";

export type LandcoverClass = {
  value: number;
  label: string;
  color: [number, number, number];
};

export type LayerSource = {
  id: string;
  url: string;
  title: string;
  dataMin: number;
  dataMax: number;
  units: string;
  displayScale: number;
  displayDecimals?: number;
  dataType: "uint16" | "float32" | "byte";
  singleBand?: boolean;
  hideRangeControls?: boolean;
  palette?: LandcoverClass[];
  colormapName?: "viridis" | "magma" | "plasma";
  bandLabels?: string[];
};

// Glasbey BW categorical palette from colorcet (b_glasbey_bw), entries 1–25
const LANDCOVER_PALETTE: LandcoverClass[] = [
  { value: 1, label: "Dense-Open Spruce", color: [0, 0, 255] },
  { value: 2, label: "Open-Woodland Spruce", color: [255, 0, 0] },
  { value: 3, label: "Stunted Spruce", color: [0, 226, 0] },
  { value: 4, label: "Broadleaf", color: [194, 0, 255] },
  { value: 5, label: "Spruce-Broadleaf", color: [255, 149, 0] },
  { value: 6, label: "Alder", color: [0, 255, 255] },
  { value: 7, label: "Willow", color: [255, 0, 240] },
  { value: 8, label: "Closed Low Shrub Birch", color: [255, 225, 0] },
  { value: 9, label: "Low Shrub Birch-Ericaceous-Willow", color: [0, 76, 154] },
  { value: 10, label: "Low Shrub-Sedge", color: [0, 194, 0] },
  { value: 11, label: "Peatland", color: [93, 0, 73] },
  { value: 12, label: "Herbaceous-Shrub", color: [77, 255, 0] },
  { value: 13, label: "Dwarf Shrub", color: [255, 189, 154] },
  { value: 14, label: "Dwarf Shrub-Rock", color: [0, 61, 0] },
  { value: 15, label: "Dry-Mesic Herbaceous", color: [0, 29, 255] },
  { value: 16, label: "Wet Herbaceous", color: [255, 123, 0] },
  { value: 17, label: "Aquatic Herbaceous", color: [0, 90, 93] },
  { value: 18, label: "Sparse Vegetation", color: [181, 164, 255] },
  { value: 19, label: "Bare Ground", color: [123, 75, 0] },
  { value: 20, label: "Snow-Ice", color: [192, 2, 90] },
  { value: 21, label: "Shadow-Indeterminate", color: [138, 123, 123] },
  { value: 22, label: "Silty Water", color: [0, 123, 0] },
  { value: 23, label: "Clear Water", color: [68, 0, 136] },
  { value: 25, label: "Cloud", color: [180, 255, 0] },
];

// Lithology — codes 1–10 (alphabetical order from shapefile DBF)
const LITHOLOGY_PALETTE: LandcoverClass[] = [
  { value: 1, label: "bedrock-acid igneous", color: [168, 124, 90] },
  { value: 2, label: "bedrock-dark sedimentary", color: [80, 80, 90] },
  { value: 3, label: "bedrock-mixed", color: [140, 130, 120] },
  { value: 4, label: "bedrock-schist", color: [110, 130, 90] },
  { value: 5, label: "unconsolidated-Nenana Gravels", color: [200, 175, 120] },
  { value: 6, label: "unconsolidated-alluvium", color: [220, 200, 130] },
  { value: 7, label: "unconsolidated-colluvium", color: [190, 150, 90] },
  { value: 8, label: "unconsolidated-drift", color: [210, 190, 150] },
  { value: 9, label: "unconsolidated-eolian", color: [240, 225, 160] },
  { value: 10, label: "water", color: [70, 130, 180] },
];

// Soil Parent Material — codes 1–16 (alphabetical order from shapefile DBF)
const SOIL_PAREN_PALETTE: LandcoverClass[] = [
  { value: 1, label: "alluvium-acid igneous", color: [255, 0, 0] },
  { value: 2, label: "alluvium-mixed", color: [0, 0, 255] },
  { value: 3, label: "alluvium-schist", color: [0, 200, 0] },
  { value: 4, label: "ash & colluvium", color: [200, 0, 255] },
  { value: 5, label: "ash over till", color: [255, 150, 0] },
  { value: 6, label: "colluvium-acid igneous", color: [0, 220, 220] },
  { value: 7, label: "colluvium-dark sedimentary", color: [255, 0, 200] },
  { value: 8, label: "colluvium-mica rich", color: [220, 200, 0] },
  { value: 9, label: "colluvium-mixed", color: [0, 80, 160] },
  { value: 10, label: "colluvium-schist", color: [0, 160, 80] },
  { value: 11, label: "drift-Nenana Gravels", color: [120, 0, 80] },
  { value: 12, label: "drift-acid igneous", color: [80, 220, 0] },
  { value: 13, label: "drift-mixed", color: [200, 160, 120] },
  { value: 14, label: "eolian", color: [0, 100, 50] },
  { value: 15, label: "eolian-mica rich", color: [0, 30, 200] },
  { value: 16, label: "water", color: [70, 130, 180] },
];

// Soil Temperature Regime — codes 1–6 (alphabetical order from shapefile DBF)
const SOIL_TEMPE_PALETTE: LandcoverClass[] = [
  { value: 1, label: "cryic", color: [100, 200, 255] },
  { value: 2, label: "cryic & pergelic-permafrost", color: [0, 100, 220] },
  { value: 3, label: "pergelic-nonpermafrost", color: [0, 200, 170] },
  { value: 4, label: "pergelic-permafrost", color: [0, 0, 200] },
  {
    value: 5,
    label: "pergelic-permafrost & nonpermafrost",
    color: [130, 0, 200],
  },
  { value: 6, label: "water", color: [70, 130, 180] },
];

export const SOURCES: LayerSource[] = [
  {
    id: "AGC_hist",
    url: `${BASE}/AGC_hist_denali.tif`,
    title: "Above-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1,
    dataMax: 3792,
    dataType: "uint16",
  },
  {
    id: "AGC_ssp585",
    url: `${BASE}/AGC_ssp585_denali.tif`,
    title: "Above-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1,
    dataMax: 3846,
    dataType: "uint16",
  },
  {
    id: "BGC_hist",
    url: `${BASE}/BGC_hist_denali.tif`,
    title: "Below-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1,
    dataMax: 5464,
    dataType: "uint16",
  },
  {
    id: "BGC_ssp585",
    url: `${BASE}/BGC_ssp585_denali.tif`,
    title: "Below-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1,
    dataMax: 5729,
    dataType: "uint16",
  },
  {
    id: "fire_risk",
    url: `${BASE}/fire_risk_denali.tif`,
    title: "Fire risk",
    units: "",
    displayScale: 1,
    displayDecimals: 2,
    dataMin: 0.02,
    dataMax: 0.74,
    dataType: "float32",
    colormapName: "magma",
    bandLabels: [
      "GFDL-ESM4 ssp126",
      "NorESM2-MM ssp126",
      "TaiESM1 ssp126",
      "UKESM1-0-LL ssp126",
      "GFDL-ESM4 ssp245",
      "NorESM2-MM ssp245",
      "TaiESM1 ssp245",
      "UKESM1-0-LL ssp245",
      "GFDL-ESM4 ssp370",
      "NorESM2-MM ssp370",
      "TaiESM1 ssp370",
      "UKESM1-0-LL ssp370",
    ],
  },
  {
    id: "landcover",
    url: `${BASE}/landcover_denali.tif`,
    title: "Land cover",
    units: "",
    displayScale: 1,
    dataMin: 0,
    dataMax: 25,
    dataType: "byte",
    singleBand: true,
    hideRangeControls: true,
    palette: LANDCOVER_PALETTE,
  },
  {
    id: "dem",
    url: `${BASE}/denali_dem.tif`,
    title: "Elevation",
    units: "m",
    displayScale: 1,
    displayDecimals: 1,
    dataMin: 74,
    dataMax: 6179,
    dataType: "float32",
    colormapName: "plasma",
  },
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
];
