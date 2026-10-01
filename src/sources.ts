const BASE = "https://data.source.coop/luddaludwig/boreal-fire-carbon";

export type LayerSource = {
  id: string;
  url: string;
  title: string;
  dataMin: number;
  dataMax: number;
  units: string;
  displayScale: number;
};

export const SOURCES: LayerSource[] = [
  {
    id: "AGC_ssp585",
    url: `${BASE}/AGC_ssp585.tif`,
    title: "Above-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 95,
    dataMax: 3295,
  },
  {
    id: "AGC_ssp126",
    url: `${BASE}/AGC_ssp126.tif`,
    title: "Above-ground combustion SSP-126",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 85,
    dataMax: 3297,
  },
  {
    id: "AGC_historical",
    url: `${BASE}/AGC_historical.tif`,
    title: "Above-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 72,
    dataMax: 3281,
  },
  {
    id: "BGC_ssp585",
    url: `${BASE}/BGC_ssp585.tif`,
    title: "Below-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1079,
    dataMax: 5645,
  },
  {
    id: "BGC_ssp126",
    url: `${BASE}/BGC_ssp126.tif`,
    title: "Below-ground combustion SSP-126",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1099,
    dataMax: 5539,
  },
  {
    id: "BGC_historical",
    url: `${BASE}/BGC_historical.tif`,
    title: "Below-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 985,
    dataMax: 5762,
  },
  {
    id: "Depth_ssp585",
    url: `${BASE}/Depth_ssp585.tif`,
    title: "Burn depth SSP-585",
    units: "cm",
    displayScale: 0.01,
    dataMin: 467,
    dataMax: 2111,
  },
  {
    id: "Depth_ssp126",
    url: `${BASE}/Depth_ssp126.tif`,
    title: "Burn depth SSP-126",
    units: "cm",
    displayScale: 0.01,
    dataMin: 491,
    dataMax: 2166,
  },
];
