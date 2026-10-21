const BASE = "https://data.source.coop/luddaludwig/boreal-fire-carbon";

export type LayerSource = {
  id: string;
  url: string;
  title: string;
  dataMin: number;
  dataMax: number;
  units: string;
  displayScale: number;
  colormap: "viridis" | "magma";
};

export const SOURCES: LayerSource[] = [
  // {
  //   id: "AGC_ssp585",
  //   url: `${BASE}/AGC_ssp585.tif`,
  //   title: "Above-ground combustion SSP-585",
  //   units: "g-C/m²",
  //   displayScale: 1,
  //   dataMin: 95,
  //   dataMax: 3295,
  // },
  {
    id: "AGC_ssp585",
    url: `${BASE}/AGC_ssp585_smoothed.tif`,
    title: "Above-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 95,
    dataMax: 3295,
    colormap: "viridis",
  },
  {
    id: "AGC_historical",
    url: `${BASE}/AGC_historical_smoothed.tif`,
    title: "Above-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 72,
    dataMax: 3281,
    colormap: "viridis",
  },
  // {
  //   id: "BGC_ssp585",
  //   url: `${BASE}/BGC_ssp585.tif`,
  //   title: "Below-ground combustion SSP-585",
  //   units: "g-C/m²",
  //   displayScale: 1,
  //   dataMin: 1079,
  //   dataMax: 5645,
  // },
  {
    id: "BGC_ssp585",
    url: `${BASE}/BGC_ssp585_smoothed.tif`,
    title: "Below-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1079,
    dataMax: 5645,
    colormap: "viridis",
  },
  {
    id: "BGC_historical",
    url: `${BASE}/BGC_historical_smoothed.tif`,
    title: "Below-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 985,
    dataMax: 5762,
    colormap: "viridis",
  },
  // {
  //   id: "Depth_ssp585",
  //   url: `${BASE}/Depth_ssp585.tif`,
  //   title: "Burn depth SSP-585",
  //   units: "cm",
  //   displayScale: 0.01,
  //   dataMin: 467,
  //   dataMax: 2111,
  // },
  {
    id: "Depth_ssp585",
    url: `${BASE}/Depth_ssp585_smoothed.tif`,
    title: "Burn depth SSP-585",
    units: "cm",
    displayScale: 0.01,
    dataMin: 467,
    dataMax: 2111,
    colormap: "viridis",
  },
  {
    id: "transient_thaw",
    url: `${BASE}/TransientThaw_C_loss_mean_ssp585_cog.tif`,
    title: "Transient Thaw C loss SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 182,
    dataMax: 21300,
    colormap: "magma",
  },
];
