const BASE =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://data.source.coop/luddaludwig/boreal-fire-carbon";

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
};

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
  },
];
