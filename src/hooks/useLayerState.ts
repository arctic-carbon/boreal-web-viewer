import { createColormapTexture } from "@developmentseed/deck.gl-raster/gpu-modules";
import type { GeoTIFF, Overview } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import proj4 from "proj4";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapLayerMouseEvent } from "react-map-gl/maplibre";
import colormap from "../colormap.js";
import type { LayerSource } from "../sources.js";
import { SOURCES } from "../sources.js";

export type TileData = {
  height: number;
  width: number;
  texture: Texture;
  rawData: Uint16Array;
};

function padRows(
  data: Uint16Array,
  width: number,
  height: number,
): Uint16Array {
  const rowBytes = width * 2;
  const alignedRowBytes = Math.ceil(rowBytes / 4) * 4;
  if (alignedRowBytes === rowBytes) {
    return data;
  }
  const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const dst = new Uint8Array(alignedRowBytes * height);
  for (let r = 0; r < height; r++) {
    dst.set(
      src.subarray(r * rowBytes, (r + 1) * rowBytes),
      r * alignedRowBytes,
    );
  }
  return new Uint16Array(dst.buffer);
}

async function fetchTileWithRetry(
  image: GeoTIFF | Overview,
  x: number,
  y: number,
  signal: AbortSignal | undefined,
  maxRetries = 3,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await image.fetchTile(x, y, { signal, boundless: false });
    } catch (err) {
      if (signal?.aborted || attempt >= maxRetries - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

export async function getTileData(
  image: GeoTIFF | Overview,
  options: { device: Device; x: number; y: number; signal?: AbortSignal },
): Promise<TileData> {
  const { device, x, y, signal } = options;
  const tile = await fetchTileWithRetry(image, x, y, signal);
  const { width, height } = tile.array;
  const data = "data" in tile.array ? tile.array.data : tile.array.bands[0]!;
  const uint16 = new Uint16Array(data.buffer, data.byteOffset, data.length);
  const aligned = padRows(uint16, width, height);
  const texture = device.createTexture({
    data: aligned,
    format: "r16unorm",
    width,
    height,
    sampler: { minFilter: "nearest", magFilter: "nearest" },
  });
  return { texture, height, width, rawData: uint16 };
}

type LoadedTile = { data: unknown };

function computeAutoScale(
  tiles: LoadedTile[],
): { min: number; max: number } | null {
  const hist = new Uint32Array(65536);
  let total = 0;
  for (const tile of tiles) {
    const d = tile.data as TileData | null | undefined;
    if (!d) {
      continue;
    }
    for (const v of d.rawData) {
      if (v === 0) {
        continue;
      }
      hist[v]++;
      total++;
    }
  }
  if (total === 0) {
    return null;
  }
  const p02 = total * 0.02;
  const p98 = total * 0.98;
  let min = 1;
  let max = 65535;
  let cumulative = 0;
  let minSet = false;
  for (let i = 1; i < 65536; i++) {
    cumulative += hist[i]!;
    if (!minSet && cumulative >= p02) {
      min = i;
      minSet = true;
    }
    if (cumulative >= p98) {
      max = i;
      break;
    }
  }
  if (min >= max) {
    return null;
  }
  return { min, max };
}

export type LayerState = {
  selectedIndex: number;
  setSelectedIndex: (i: number) => void;
  selected: LayerSource;
  rangeMin: number;
  setRangeMin: (v: number) => void;
  rangeMax: number;
  setRangeMax: (v: number) => void;
  dataOpacity: number;
  setDataOpacity: (v: number) => void;
  panelOpen: boolean;
  setPanelOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  device: Device | null;
  setDevice: (d: Device) => void;
  deviceError: string | null;
  colormapTexture: Texture | null;
  metadataLoaded: boolean;
  tilesLoading: boolean;
  clickInfo: { lng: number; lat: number; value: number } | null;
  setClickInfo: (v: { lng: number; lat: number; value: number } | null) => void;
  pendingAutoScale: { min: number; max: number } | null;
  handleViewportLoad: (tiles: LoadedTile[]) => void;
  applyAutoScale: () => void;
  trackingGetTileData: typeof getTileData;
  handleGeoTIFFLoad: (
    tiff: GeoTIFF,
    options: {
      projection: unknown;
      geographicBounds: {
        west: number;
        south: number;
        east: number;
        north: number;
      };
    },
  ) => void;
  handleMapClick: (e: MapLayerMouseEvent) => Promise<void>;
};

export function useLayerState(initialIndex = 0): LayerState {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const [rangeMin, setRangeMin] = useState(SOURCES[initialIndex]!.dataMin);
  const [rangeMax, setRangeMax] = useState(SOURCES[initialIndex]!.dataMax);
  const [dataOpacity, setDataOpacity] = useState(1);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 768);
  const [device, setDevice] = useState<Device | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(false);
  const [clickInfo, setClickInfo] = useState<{
    lng: number;
    lat: number;
    value: number;
  } | null>(null);
  const [pendingAutoScale, setPendingAutoScale] = useState<{
    min: number;
    max: number;
  } | null>(null);

  const loadingCountRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shouldAutoScaleRef = useRef(true);
  const geotiffRef = useRef<{
    geotiff: GeoTIFF;
    toSourceCRS: (lng: number, lat: number) => [number, number];
  } | null>(null);

  const selected = SOURCES[selectedIndex]!;

  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => {
    setRangeMin(SOURCES[selectedIndex]!.dataMin);
    setRangeMax(SOURCES[selectedIndex]!.dataMax);
    setMetadataLoaded(false);
    setClickInfo(null);
    shouldAutoScaleRef.current = true;
    setPendingAutoScale(null);
  }, [selectedIndex]);

  useEffect(() => {
    if (!device) {
      return;
    }
    if (!device.features.has("norm16-renderable-webgl")) {
      setDeviceError(
        "This application requires advanced graphics features that are not available in your current browser. Please try opening it in Chrome, Edge, or Brave instead.",
      );
      return;
    }
    setColormapTexture(createColormapTexture(device, colormap));
  }, [device]);

  const trackingGetTileData: typeof getTileData = useCallback(
    async (image, options) => {
      loadingCountRef.current++;
      if (loadingCountRef.current === 1) {
        clearTimeout(hideTimerRef.current);
        setTilesLoading(true);
      }
      try {
        return await getTileData(image, options);
      } finally {
        loadingCountRef.current--;
        if (loadingCountRef.current === 0) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => setTilesLoading(false), 150);
        }
      }
    },
    [],
  );

  const handleViewportLoad = useCallback((tiles: LoadedTile[]) => {
    const computed = computeAutoScale(tiles);
    if (!computed) {
      return;
    }
    setPendingAutoScale(computed);
    if (shouldAutoScaleRef.current) {
      setRangeMin(computed.min);
      setRangeMax(computed.max);
      shouldAutoScaleRef.current = false;
    }
  }, []);

  const applyAutoScale = useCallback(() => {
    setPendingAutoScale((prev) => {
      if (prev) {
        setRangeMin(prev.min);
        setRangeMax(prev.max);
      }
      return prev;
    });
  }, []);

  const handleGeoTIFFLoad = useCallback(
    (
      tiff: GeoTIFF,
      options: {
        projection: unknown;
        geographicBounds: {
          west: number;
          south: number;
          east: number;
          north: number;
        };
      },
    ) => {
      setMetadataLoaded(true);
      const sourceProj = new proj4.Proj(
        options.projection as unknown as proj4.ProjectionDefinition,
      );
      const converter = proj4("EPSG:4326", sourceProj);
      geotiffRef.current = {
        geotiff: tiff,
        toSourceCRS: (lng, lat) =>
          converter.forward<[number, number]>([lng, lat], false),
      };
    },
    [],
  );

  const handleMapClick = useCallback(async (e: MapLayerMouseEvent) => {
    const ref = geotiffRef.current;
    if (!ref) {
      return;
    }
    const { geotiff, toSourceCRS } = ref;
    const [x, y] = toSourceCRS(e.lngLat.lng, e.lngLat.lat);
    const [row, col] = geotiff.index(x, y);
    if (row < 0 || row >= geotiff.height || col < 0 || col >= geotiff.width) {
      setClickInfo(null);
      return;
    }
    const tileX = Math.floor(col / geotiff.tileWidth);
    const tileY = Math.floor(row / geotiff.tileHeight);
    try {
      const tile = await geotiff.fetchTile(tileX, tileY);
      const px = col % geotiff.tileWidth;
      const py = row % geotiff.tileHeight;
      const arr = "data" in tile.array ? tile.array.data : tile.array.bands[0]!;
      const value = arr[py * tile.array.width + px]!;
      if (value === 0) {
        setClickInfo(null);
      } else {
        setClickInfo({ lng: e.lngLat.lng, lat: e.lngLat.lat, value });
      }
    } catch {
      setClickInfo(null);
    }
  }, []);

  return {
    selectedIndex,
    setSelectedIndex,
    selected,
    rangeMin,
    setRangeMin,
    rangeMax,
    setRangeMax,
    dataOpacity,
    setDataOpacity,
    panelOpen,
    setPanelOpen,
    device,
    setDevice,
    deviceError,
    colormapTexture,
    metadataLoaded,
    tilesLoading,
    clickInfo,
    setClickInfo,
    pendingAutoScale,
    handleViewportLoad,
    applyAutoScale,
    trackingGetTileData,
    handleGeoTIFFLoad,
    handleMapClick,
  };
}
