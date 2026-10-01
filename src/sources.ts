const BASE =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://data.source.coop/luddaludwig/boreal-fire-carbon";

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
];
