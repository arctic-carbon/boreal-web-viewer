# Auto-scale Button, Colorbar Labels, and Comparison Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract per-panel state into a `useLayerState` hook and panel UI into a `LayerPanel` component, add an auto-scale button and colorbar min/max labels, then implement a draggable swipe comparison mode with independent source selectors and a match-scale button.

**Architecture:** `useLayerState` encapsulates all per-panel state/callbacks (selected source, scale range, opacity, device, tile loading, click-to-query, auto-scale). `LayerPanel` is a single panel component rendered once in explore mode and twice in compare mode. `App.tsx` retains only global concerns: mode, basemap, shared viewState, the two map instances, and COGLayer construction.

**Tech Stack:** React 19, TypeScript, Vite 7, deck.gl-raster `COGLayer`, `react-map-gl/maplibre`, luma.gl. Biome for lint/format.

## Global Constraints

- `pnpm check` must pass before every commit (Biome lint + format)
- Husky pre-commit runs Biome on staged files automatically
- Use `.js` extensions on all local imports (TypeScript + Vite ESM convention already in use)
- No new npm dependencies — implement divider drag with raw DOM events
- Keep `cache: "no-store"` on `SourceHttp.fetch` — do not remove
- Zero is nodata — do not change colormap or alpha logic
- Commit messages: Conventional Commits format, `Co-authored-by: Claude <noreply@anthropic.com>` trailer
- `pnpm dev` starts dev server on `http://localhost:3000`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/hooks/useLayerState.ts` | All per-panel state, callbacks, tile loading, auto-scale |
| Create | `src/components/LayerPanel.tsx` | Panel UI: source selector, sliders, auto-scale button, colorbar with min/max labels, match-scale button |
| Modify | `src/App.tsx` | Global state only: mode, basemap, viewState, COGLayer construction, map layout |
| Keep | `src/sources.ts` | Unchanged |
| Keep | `src/colormap.ts` | Unchanged |

---

## Task 1: Extract `useLayerState` hook

Moves all per-panel state and callbacks out of `App.tsx` into a reusable hook. No behavior change — the app works identically after this task.

**Files:**
- Create: `src/hooks/useLayerState.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `useLayerState()` returning `LayerState`, exported `TileData` type, exported `getTileData` function

---

- [ ] **Step 1: Create `src/hooks/useLayerState.ts`**

```typescript
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
  if (alignedRowBytes === rowBytes) return data;
  const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const dst = new Uint8Array(alignedRowBytes * height);
  for (let r = 0; r < height; r++) {
    dst.set(src.subarray(r * rowBytes, (r + 1) * rowBytes), r * alignedRowBytes);
  }
  return new Uint16Array(dst.buffer);
}

export async function getTileData(
  image: GeoTIFF | Overview,
  options: { device: Device; x: number; y: number; signal?: AbortSignal },
): Promise<TileData> {
  const { device, x, y, signal } = options;
  const tile = await image.fetchTile(x, y, { signal, boundless: false });
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

type LoadedTile = { data: TileData | null | undefined };

function computeAutoScale(
  tiles: LoadedTile[],
): { min: number; max: number } | null {
  const hist = new Uint32Array(65536);
  let total = 0;
  for (const tile of tiles) {
    const d = tile.data;
    if (!d) continue;
    for (const v of d.rawData) {
      if (v === 0) continue;
      hist[v]++;
      total++;
    }
  }
  if (total === 0) return null;
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
  if (min >= max) return null;
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
    if (!device) return;
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
    if (!computed) return;
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
    if (!ref) return;
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
      const arr =
        "data" in tile.array ? tile.array.data : tile.array.bands[0]!;
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
```

- [ ] **Step 2: Replace `src/App.tsx` with the hook-based version**

Replace the entire contents of `src/App.tsx` with the following. The behavior is identical to the original — this is a pure refactor.

```typescript
import { SourceHttp } from "@chunkd/source-http";
import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { ShaderModule } from "@luma.gl/shadertools";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, Popup, useControl } from "react-map-gl/maplibre";
import type { TileData } from "./hooks/useLayerState.js";
import { useLayerState } from "./hooks/useLayerState.js";
import { SOURCES } from "./sources.js";

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

const BASEMAPS = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  satellite: {
    version: 8 as const,
    sources: {
      "esri-satellite": {
        type: "raster" as const,
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution:
          "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      },
    },
    layers: [
      {
        id: "esri-satellite-layer",
        type: "raster" as const,
        source: "esri-satellite",
      },
    ],
  },
} as const;

type BasemapKey = keyof typeof BASEMAPS;

// Bypass Chrome's single-writer cache lock on range requests to avoid
// serialized tile fetches (see Chromium disk cache locking behavior).
// Scoped to SourceHttp only — does not affect MapLibre or other fetches.
SourceHttp.fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

const MAX_TILE_REQUESTS = 20;

type RescaleProps = { rangeMin: number; rangeMax: number };

const Rescale = {
  name: "rescale",
  fs: `\
uniform rescaleUniforms {
  float rangeMin;
  float rangeMax;
} rescale;
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float rawValue = color.r * 65535.0;
      if (rawValue == 0.0) discard;
      float t = clamp(
        (rawValue - rescale.rangeMin) / (rescale.rangeMax - rescale.rangeMin),
        0.0,
        1.0
      );
      color.r = t;
    `,
  },
  uniformTypes: {
    rangeMin: "f32",
    rangeMax: "f32",
  },
  getUniforms: (props: Partial<RescaleProps>) => ({
    rangeMin: props.rangeMin ?? 0,
    rangeMax: props.rangeMax ?? 65535,
  }),
} as const satisfies ShaderModule<RescaleProps>;

const SetAlpha1 = {
  name: "set-alpha-1",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = vec4(color.rgb, 1.0);
    `,
  },
} as const satisfies ShaderModule;

function fmtVal(raw: number, src: (typeof SOURCES)[number]): string {
  return (raw * src.displayScale).toFixed(src.displayScale < 1 ? 2 : 0);
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const hasInitialFitRef = useRef(false);
  const [basemap, setBasemap] = useState<BasemapKey>("dark");

  const leftState = useLayerState();
  const layers: ReturnType<typeof COGLayer<TileData>>[] = [];

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  if (leftState.colormapTexture && leftState.selected.url) {
    const cogLayer = new COGLayer<TileData>({
      id: "cog-layer",
      opacity: leftState.dataOpacity,
      geotiff: leftState.selected.url,
      maxRequests: MAX_TILE_REQUESTS,
      getTileData: leftState.trackingGetTileData,
      renderTile: (tileData: TileData): RenderTileResult => ({
        renderPipeline: [
          {
            module: CreateTexture,
            props: { textureName: tileData.texture },
          },
          {
            module: Rescale,
            props: {
              rangeMin: leftState.rangeMin,
              rangeMax: leftState.rangeMax,
            },
          },
          {
            module: Colormap,
            props: {
              colormapTexture: leftState.colormapTexture,
              colormapIndex: 0,
            },
          },
          { module: SetAlpha1 },
        ],
      }),
      onGeoTIFFLoad: (tiff, options) => {
        leftState.handleGeoTIFFLoad(tiff, options);
        if (!hasInitialFitRef.current) {
          hasInitialFitRef.current = true;
          const { west, south, east, north } = options.geographicBounds;
          mapRef.current?.fitBounds(
            [
              [west, south],
              [east, north],
            ],
            { padding: 40, duration: 1000 },
          );
        }
      },
      onViewportLoad: leftState.handleViewportLoad,
      ...(basemap === "dark" && { beforeId: "boundary_country_outline" }),
    });
    layers.push(cogLayer);
  }

  if (leftState.deviceError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          padding: "20px",
          textAlign: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div>
          <h2 style={{ marginBottom: "8px" }}>Browser Not Supported</h2>
          <p style={{ color: "#666" }}>{leftState.deviceError}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MaplibreMap
        ref={mapRef}
        initialViewState={{
          longitude: -112.5,
          latitude: 60,
          zoom: 3,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle={BASEMAPS[basemap] as string}
        onClick={leftState.handleMapClick}
      >
        <DeckGLOverlay
          layers={layers}
          // @ts-expect-error interleaved is valid for MapboxOverlay but missing from DeckProps
          interleaved
          onDeviceInitialized={leftState.setDevice}
        />
        {leftState.clickInfo && (
          <Popup
            longitude={leftState.clickInfo.lng}
            latitude={leftState.clickInfo.lat}
            closeOnClick={false}
            onClose={() => leftState.setClickInfo(null)}
            anchor="bottom"
          >
            <div style={{ lineHeight: 1.5 }}>
              <div>
                <span style={{ opacity: 0.6 }}>Value</span>{" "}
                <strong>
                  {fmtVal(leftState.clickInfo.value, leftState.selected)}{" "}
                  {leftState.selected.units}
                </strong>
              </div>
              <div>
                <span style={{ opacity: 0.6 }}>Lat</span>{" "}
                {leftState.clickInfo.lat.toFixed(5)}
              </div>
              <div>
                <span style={{ opacity: 0.6 }}>Lon</span>{" "}
                {leftState.clickInfo.lng.toFixed(5)}
              </div>
            </div>
          </Popup>
        )}
      </MaplibreMap>

      {/* Loading spinner */}
      {(leftState.tilesLoading ||
        (leftState.colormapTexture && !leftState.metadataLoaded)) && (
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(0, 0, 0, 0.7)",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: "20px",
            fontSize: "13px",
          }}
        >
          <div
            style={{
              width: "14px",
              height: "14px",
              border: "2px solid rgba(255,255,255,0.3)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          {!leftState.metadataLoaded ? "Loading metadata…" : "Loading tiles…"}
        </div>
      )}

      {/* Panel toggle button (shown when collapsed) */}
      {!leftState.panelOpen && (
        <button
          type="button"
          onClick={() => leftState.setPanelOpen(true)}
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            zIndex: 1000,
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            border: "none",
            background: "white",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            cursor: "pointer",
            fontSize: "18px",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label="Open settings"
        >
          &#9776;
        </button>
      )}

      {/* Info Panel */}
      {leftState.panelOpen && (
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            zIndex: 1000,
            background: "white",
            padding: "16px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            maxWidth: "320px",
            width: "calc(100vw - 40px)",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div>
              <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>
                Potential Wildfire Carbon Losses
              </h3>
              <p
                style={{
                  margin: "0 0 12px 0",
                  fontSize: "12px",
                  color: "#666",
                }}
              >
                Scenarios: historical, SSP-126, or SSP-585
              </p>
            </div>
            <button
              type="button"
              onClick={() => leftState.setPanelOpen(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: "18px",
                lineHeight: 1,
                padding: "0 0 0 8px",
                color: "#999",
              }}
              aria-label="Close settings"
            >
              &#10005;
            </button>
          </div>

          <div>
            <p
              style={{
                margin: "0 0 12px 0",
                fontSize: "12px",
                color: "#666",
              }}
            >
              Select layer
            </p>
            <select
              value={leftState.selectedIndex}
              onChange={(e) =>
                leftState.setSelectedIndex(Number(e.target.value))
              }
              style={{
                width: "100%",
                padding: "6px 12px",
                fontSize: "12px",
                background: "#f0f0f0",
                border: "1px solid #ccc",
                borderRadius: "4px",
                cursor: "pointer",
                marginBottom: "12px",
              }}
            >
              {SOURCES.map((src, i) => (
                <option key={src.id} value={i}>
                  {src.title}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "8px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "2px",
              }}
            >
              Min: {fmtVal(leftState.rangeMin, leftState.selected)}{" "}
              {leftState.selected.units}
              <input
                type="range"
                min={leftState.selected.dataMin}
                max={leftState.selected.dataMax}
                step={1}
                value={leftState.rangeMin}
                onChange={(e) =>
                  leftState.setRangeMin(
                    Math.min(
                      parseFloat(e.target.value),
                      leftState.rangeMax - 1,
                    ),
                  )
                }
                style={{ width: "100%", cursor: "pointer" }}
              />
            </label>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "2px",
              }}
            >
              Max: {fmtVal(leftState.rangeMax, leftState.selected)}{" "}
              {leftState.selected.units}
              <input
                type="range"
                min={leftState.selected.dataMin}
                max={leftState.selected.dataMax}
                step={1}
                value={leftState.rangeMax}
                onChange={(e) =>
                  leftState.setRangeMax(
                    Math.max(
                      parseFloat(e.target.value),
                      leftState.rangeMin + 1,
                    ),
                  )
                }
                style={{ width: "100%", cursor: "pointer" }}
              />
            </label>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <button
              type="button"
              onClick={() =>
                setBasemap((b) => (b === "dark" ? "satellite" : "dark"))
              }
              style={{
                width: "100%",
                padding: "6px 12px",
                fontSize: "12px",
                cursor: "pointer",
                background: "#f0f0f0",
                border: "1px solid #ccc",
                borderRadius: "4px",
              }}
            >
              {basemap === "dark"
                ? "Switch to satellite basemap"
                : "Switch to dark basemap"}
            </button>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "2px",
              }}
            >
              Data Opacity: {Math.round(leftState.dataOpacity * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={leftState.dataOpacity}
                onChange={(e) =>
                  leftState.setDataOpacity(parseFloat(e.target.value))
                }
                style={{ width: "100%", cursor: "pointer" }}
              />
            </label>
          </div>

          <div
            style={{
              height: "12px",
              borderRadius: "2px",
              background:
                "linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #b5de2b, #fde725)",
              marginBottom: "4px",
            }}
          />
          <p
            style={{
              margin: "0 0 12px 0",
              fontSize: "11px",
              color: "#999",
              textAlign: "center",
            }}
          >
            {leftState.selected.units}
          </p>

          <p style={{ margin: 0, fontSize: "11px", color: "#999" }}>
            Data:{" "}
            <a
              href="https://source.coop/luddaludwig/boreal-fire-carbon"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#666" }}
            >
              source.coop
            </a>
            {" | "}
            Rendered with{" "}
            <a
              href="https://github.com/developmentseed/deck.gl-raster"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#666",
                fontFamily: "monospace",
                fontSize: "10px",
              }}
            >
              deck.gl-raster
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run Biome check**

```bash
pnpm check
```

Expected: no errors. Fix any formatting issues with `pnpm check:fix`.

- [ ] **Step 4: Verify in browser**

```bash
pnpm dev
```

Open `http://localhost:3000`. Verify:
- Map loads, tiles render with viridis colormap
- Source selector changes the layer
- Min/max sliders update colors live
- Basemap toggle works
- Opacity slider works
- Click-to-query popup works
- Panel collapses and reopens

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLayerState.ts src/App.tsx
git commit -m "refactor: extract useLayerState hook from App

Co-authored-by: Claude <noreply@anthropic.com>"
```

---

## Task 2: Create `LayerPanel` component + auto-scale button + colorbar labels

Extracts the panel UI from `App.tsx` into a reusable `LayerPanel` component. Adds the auto-scale button (Feature 1) and min/max labels on the colorbar (Feature 2) as part of the initial component implementation.

`LayerPanel` handles its own open/close toggle so it can be self-contained in both modes.

**Files:**
- Create: `src/components/LayerPanel.tsx`
- Modify: `src/App.tsx` — replace inline panel JSX with `<LayerPanel>`

**Interfaces:**
- Consumes: `LayerState` from `src/hooks/useLayerState.ts`
- Produces: `LayerPanel` component, `LayerPanelProps` type

---

- [ ] **Step 1: Create `src/components/LayerPanel.tsx`**

```typescript
import { SOURCES } from "../sources.js";
import type { LayerState } from "../hooks/useLayerState.js";

type BasemapKey = "dark" | "satellite";

export type LayerPanelProps = {
  state: LayerState;
  basemap: BasemapKey;
  onToggleBasemap: () => void;
  side?: "left" | "right";
  compareMode?: boolean;
  onMatchScale?: () => void;
  matchScaleEnabled?: boolean;
};

function fmtVal(raw: number, src: (typeof SOURCES)[number]): string {
  return (raw * src.displayScale).toFixed(src.displayScale < 1 ? 2 : 0);
}

export function LayerPanel({
  state,
  basemap,
  onToggleBasemap,
  side,
  compareMode = false,
  onMatchScale,
  matchScaleEnabled = false,
}: LayerPanelProps) {
  const isRight = side === "right";

  const toggleBtnStyle: React.CSSProperties = {
    position: "absolute",
    top: "20px",
    ...(isRight ? { right: "20px" } : { left: "20px" }),
    zIndex: 1000,
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    border: "none",
    background: "white",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    cursor: "pointer",
    fontSize: "18px",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const panelStyle: React.CSSProperties = {
    position: "absolute",
    top: "20px",
    ...(isRight ? { right: "20px" } : { left: "20px" }),
    zIndex: 1000,
    background: "white",
    padding: "16px",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    maxWidth: "320px",
    width: "calc(100vw - 40px)",
    boxSizing: "border-box" as const,
  };

  if (!state.panelOpen) {
    return (
      <button
        type="button"
        onClick={() => state.setPanelOpen(true)}
        style={toggleBtnStyle}
        aria-label="Open settings"
      >
        &#9776;
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>
            Potential Wildfire Carbon Losses
          </h3>
          <p
            style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#666" }}
          >
            Scenarios: historical, SSP-126, or SSP-585
          </p>
        </div>
        <button
          type="button"
          onClick={() => state.setPanelOpen(false)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "18px",
            lineHeight: 1,
            padding: "0 0 0 8px",
            color: "#999",
          }}
          aria-label="Close settings"
        >
          &#10005;
        </button>
      </div>

      {/* Source selector */}
      <div>
        <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#666" }}>
          Select layer
        </p>
        <select
          value={state.selectedIndex}
          onChange={(e) => state.setSelectedIndex(Number(e.target.value))}
          style={{
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            background: "#f0f0f0",
            border: "1px solid #ccc",
            borderRadius: "4px",
            cursor: "pointer",
            marginBottom: "12px",
          }}
        >
          {SOURCES.map((src, i) => (
            <option key={src.id} value={i}>
              {src.title}
            </option>
          ))}
        </select>
      </div>

      {/* Min slider */}
      <div style={{ marginBottom: "8px" }}>
        <label
          style={{
            display: "block",
            fontSize: "12px",
            color: "#666",
            marginBottom: "2px",
          }}
        >
          Min: {fmtVal(state.rangeMin, state.selected)} {state.selected.units}
          <input
            type="range"
            min={state.selected.dataMin}
            max={state.selected.dataMax}
            step={1}
            value={state.rangeMin}
            onChange={(e) =>
              state.setRangeMin(
                Math.min(parseFloat(e.target.value), state.rangeMax - 1),
              )
            }
            style={{ width: "100%", cursor: "pointer" }}
          />
        </label>
      </div>

      {/* Max slider */}
      <div style={{ marginBottom: "8px" }}>
        <label
          style={{
            display: "block",
            fontSize: "12px",
            color: "#666",
            marginBottom: "2px",
          }}
        >
          Max: {fmtVal(state.rangeMax, state.selected)} {state.selected.units}
          <input
            type="range"
            min={state.selected.dataMin}
            max={state.selected.dataMax}
            step={1}
            value={state.rangeMax}
            onChange={(e) =>
              state.setRangeMax(
                Math.max(parseFloat(e.target.value), state.rangeMin + 1),
              )
            }
            style={{ width: "100%", cursor: "pointer" }}
          />
        </label>
      </div>

      {/* Auto-scale button */}
      <div style={{ marginBottom: "12px" }}>
        <button
          type="button"
          onClick={state.applyAutoScale}
          disabled={state.pendingAutoScale === null}
          style={{
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            cursor: state.pendingAutoScale === null ? "default" : "pointer",
            background: "#f0f0f0",
            border: "1px solid #ccc",
            borderRadius: "4px",
            opacity: state.pendingAutoScale === null ? 0.5 : 1,
          }}
        >
          Auto-scale
        </button>
      </div>

      {/* Basemap toggle */}
      <div style={{ marginBottom: "12px" }}>
        <button
          type="button"
          onClick={onToggleBasemap}
          style={{
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            cursor: "pointer",
            background: "#f0f0f0",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        >
          {basemap === "dark"
            ? "Switch to satellite basemap"
            : "Switch to dark basemap"}
        </button>
      </div>

      {/* Opacity slider */}
      <div style={{ marginBottom: "12px" }}>
        <label
          style={{
            display: "block",
            fontSize: "12px",
            color: "#666",
            marginBottom: "2px",
          }}
        >
          Data Opacity: {Math.round(state.dataOpacity * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.dataOpacity}
            onChange={(e) => state.setDataOpacity(parseFloat(e.target.value))}
            style={{ width: "100%", cursor: "pointer" }}
          />
        </label>
      </div>

      {/* Colormap gradient with min/max labels */}
      <div
        style={{
          height: "12px",
          borderRadius: "2px",
          background:
            "linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #b5de2b, #fde725)",
          marginBottom: "4px",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "11px",
          color: "#999",
          marginBottom: "12px",
        }}
      >
        <span>{fmtVal(state.rangeMin, state.selected)}</span>
        <span>{state.selected.units}</span>
        <span>{fmtVal(state.rangeMax, state.selected)}</span>
      </div>

      {/* Match scale button — right panel in compare mode only */}
      {compareMode && isRight && (
        <div style={{ marginBottom: "12px" }}>
          <button
            type="button"
            onClick={onMatchScale}
            disabled={!matchScaleEnabled}
            title={
              matchScaleEnabled
                ? undefined
                : "Sources must have the same units to match scale"
            }
            style={{
              width: "100%",
              padding: "6px 12px",
              fontSize: "12px",
              cursor: matchScaleEnabled ? "pointer" : "default",
              background: "#f0f0f0",
              border: "1px solid #ccc",
              borderRadius: "4px",
              opacity: matchScaleEnabled ? 1 : 0.5,
            }}
          >
            ← Match scale
          </button>
        </div>
      )}

      <p style={{ margin: 0, fontSize: "11px", color: "#999" }}>
        Data:{" "}
        <a
          href="https://source.coop/luddaludwig/boreal-fire-carbon"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#666" }}
        >
          source.coop
        </a>
        {" | "}
        Rendered with{" "}
        <a
          href="https://github.com/developmentseed/deck.gl-raster"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#666", fontFamily: "monospace", fontSize: "10px" }}
        >
          deck.gl-raster
        </a>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Replace panel JSX in `src/App.tsx` with `<LayerPanel>`**

In `App.tsx`:

1. Add imports at the top:
```typescript
import { LayerPanel } from "./components/LayerPanel.js";
```

2. Remove the `fmtVal` function (it moved to `LayerPanel.tsx`).

3. Replace the entire panel section (the `{/* Panel toggle button */}` and `{/* Info Panel */}` blocks) with:

```tsx
      <LayerPanel
        state={leftState}
        basemap={basemap}
        onToggleBasemap={() =>
          setBasemap((b) => (b === "dark" ? "satellite" : "dark"))
        }
      />
```

- [ ] **Step 3: Run Biome check**

```bash
pnpm check
```

Fix any issues with `pnpm check:fix`.

- [ ] **Step 4: Verify in browser**

```bash
pnpm dev
```

Open `http://localhost:3000`. Verify:
- Panel opens and closes with the hamburger button
- Source selector, sliders, basemap toggle, opacity slider all work
- Auto-scale button is disabled on first load, becomes enabled after tiles load
- Clicking Auto-scale updates the min/max sliders to the 2%/98% range of visible tiles
- Switching layers resets scale and re-enables auto-scale on next tile load
- Colorbar shows `{min}  {units}  {max}` with live-updating values as sliders move

- [ ] **Step 5: Commit**

```bash
git add src/components/LayerPanel.tsx src/App.tsx
git commit -m "feat(ui): add LayerPanel component with auto-scale button and colorbar labels

Co-authored-by: Claude <noreply@anthropic.com>"
```

---

## Task 3: Mode toggle + controlled viewState

Adds the explore/compare mode toggle button and switches `MaplibreMap` to controlled `viewState`. Compare mode shows nothing extra yet — this task just sets up the infrastructure without breaking explore mode.

**Files:**
- Modify: `src/App.tsx` only

---

- [ ] **Step 1: Add mode state and viewState to `App.tsx`**

In `App.tsx`, inside the `App()` function, add after the existing state declarations:

```typescript
  const [mode, setMode] = useState<"explore" | "compare">("explore");
  const [viewState, setViewState] = useState({
    longitude: -112.5,
    latitude: 60,
    zoom: 3,
    pitch: 0 as number,
    bearing: 0 as number,
  });
```

- [ ] **Step 2: Switch `MaplibreMap` to controlled viewState**

Replace the `MaplibreMap` opening tag (currently uses `initialViewState`) with controlled `viewState`:

```tsx
      <MaplibreMap
        ref={mapRef}
        viewState={viewState}
        onMove={(e) => setViewState(e.viewState)}
        mapStyle={BASEMAPS[basemap] as string}
        onClick={leftState.handleMapClick}
      >
```

Note: remove `initialViewState` and add `viewState` + `onMove`. The `fitBounds` call in `onGeoTIFFLoad` still works on the ref — no change needed there.

- [ ] **Step 3: Add the mode toggle button**

Add a mode toggle pill control just before the closing `</div>` of the root element (after the `<LayerPanel>` line), positioned at top-center:

```tsx
      {/* Mode toggle */}
      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1001,
          display: "flex",
          background: "white",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          overflow: "hidden",
        }}
      >
        {(["explore", "compare"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              padding: "6px 14px",
              fontSize: "12px",
              border: "none",
              cursor: "pointer",
              background: mode === m ? "#3b528b" : "transparent",
              color: mode === m ? "white" : "#444",
              fontWeight: mode === m ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {m}
          </button>
        ))}
      </div>
```

- [ ] **Step 4: Run Biome check**

```bash
pnpm check
```

- [ ] **Step 5: Verify in browser**

```bash
pnpm dev
```

Open `http://localhost:3000`. Verify:
- Mode toggle pill appears at top center
- Clicking "Compare" / "Explore" highlights the active button (no other change yet)
- Map still pans, zooms, loads tiles normally
- `fitBounds` on initial load still flies to the data extent

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): add mode toggle and controlled viewState

Co-authored-by: Claude <noreply@anthropic.com>"
```

---

## Task 4: Compare mode — second map, divider, right panel, match scale

Implements the full comparison mode: two synchronized `MaplibreMap` instances stacked with CSS clip, a draggable divider, a right `LayerPanel` with its own source/scale controls, and a match-scale button.

**Files:**
- Modify: `src/App.tsx` only

---

- [ ] **Step 1: Add `rightState` and divider state to `App.tsx`**

In `App.tsx`, inside `App()`, add after `const leftState = useLayerState();`:

```typescript
  const rightState = useLayerState(1); // default to second source for variety
  const [dividerX, setDividerX] = useState(() => window.innerWidth / 2);
  const isDraggingRef = useRef(false);
```

- [ ] **Step 2: Add drag handlers for the divider**

Add these callbacks inside `App()`, after the `useEffect` for spin keyframes:

```typescript
  const handleDividerMouseDown = useCallback(() => {
    isDraggingRef.current = true;
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      setDividerX(Math.max(50, Math.min(window.innerWidth - 50, e.clientX)));
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const handleDividerTouchStart = useCallback(
    (e: React.TouchEvent) => {
      isDraggingRef.current = true;
      const onTouchMove = (ev: TouchEvent) => {
        if (!isDraggingRef.current || !ev.touches[0]) return;
        setDividerX(
          Math.max(
            50,
            Math.min(window.innerWidth - 50, ev.touches[0].clientX),
          ),
        );
      };
      const onTouchEnd = () => {
        isDraggingRef.current = false;
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
      };
      document.addEventListener("touchmove", onTouchMove, { passive: true });
      document.addEventListener("touchend", onTouchEnd);
    },
    [],
  );
```

- [ ] **Step 3: Build right COGLayer**

Add right COGLayer construction immediately after the left `layers.push(cogLayer)` block:

```typescript
  const rightLayers: ReturnType<typeof COGLayer<TileData>>[] = [];
  if (mode === "compare" && rightState.colormapTexture && rightState.selected.url) {
    const rightCogLayer = new COGLayer<TileData>({
      id: "cog-layer-right",
      opacity: rightState.dataOpacity,
      geotiff: rightState.selected.url,
      maxRequests: MAX_TILE_REQUESTS,
      getTileData: rightState.trackingGetTileData,
      renderTile: (tileData: TileData): RenderTileResult => ({
        renderPipeline: [
          {
            module: CreateTexture,
            props: { textureName: tileData.texture },
          },
          {
            module: Rescale,
            props: {
              rangeMin: rightState.rangeMin,
              rangeMax: rightState.rangeMax,
            },
          },
          {
            module: Colormap,
            props: {
              colormapTexture: rightState.colormapTexture,
              colormapIndex: 0,
            },
          },
          { module: SetAlpha1 },
        ],
      }),
      onGeoTIFFLoad: (tiff, options) => {
        rightState.handleGeoTIFFLoad(tiff, options);
      },
      onViewportLoad: rightState.handleViewportLoad,
      ...(basemap === "dark" && { beforeId: "boundary_country_outline" }),
    });
    rightLayers.push(rightCogLayer);
  }
```

- [ ] **Step 4: Replace the JSX return with compare-mode-aware layout**

Replace the entire `return (...)` in `App.tsx` with the following. This retains all existing explore-mode markup and adds the compare-mode overlay:

```tsx
  if (leftState.deviceError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          padding: "20px",
          textAlign: "center",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div>
          <h2 style={{ marginBottom: "8px" }}>Browser Not Supported</h2>
          <p style={{ color: "#666" }}>{leftState.deviceError}</p>
        </div>
      </div>
    );
  }

  const matchScaleEnabled =
    leftState.selected.units === rightState.selected.units;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Left map — always full screen */}
      <MaplibreMap
        ref={mapRef}
        viewState={viewState}
        onMove={(e) => setViewState(e.viewState)}
        mapStyle={BASEMAPS[basemap] as string}
        onClick={leftState.handleMapClick}
        style={{ position: "absolute", inset: 0 }}
      >
        <DeckGLOverlay
          layers={layers}
          // @ts-expect-error interleaved is valid for MapboxOverlay but missing from DeckProps
          interleaved
          onDeviceInitialized={leftState.setDevice}
        />
        {leftState.clickInfo && (
          <Popup
            longitude={leftState.clickInfo.lng}
            latitude={leftState.clickInfo.lat}
            closeOnClick={false}
            onClose={() => leftState.setClickInfo(null)}
            anchor="bottom"
          >
            <div style={{ lineHeight: 1.5 }}>
              <div>
                <span style={{ opacity: 0.6 }}>Value</span>{" "}
                <strong>
                  {(leftState.clickInfo.value * leftState.selected.displayScale).toFixed(
                    leftState.selected.displayScale < 1 ? 2 : 0,
                  )}{" "}
                  {leftState.selected.units}
                </strong>
              </div>
              <div>
                <span style={{ opacity: 0.6 }}>Lat</span>{" "}
                {leftState.clickInfo.lat.toFixed(5)}
              </div>
              <div>
                <span style={{ opacity: 0.6 }}>Lon</span>{" "}
                {leftState.clickInfo.lng.toFixed(5)}
              </div>
            </div>
          </Popup>
        )}
      </MaplibreMap>

      {/* Right map — only in compare mode, clipped to right of divider */}
      {mode === "compare" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `inset(0 0 0 ${dividerX}px)`,
          }}
        >
          <MaplibreMap
            viewState={viewState}
            onMove={(e) => setViewState(e.viewState)}
            mapStyle={BASEMAPS[basemap] as string}
            onClick={rightState.handleMapClick}
            style={{ position: "absolute", inset: 0 }}
          >
            <DeckGLOverlay
              layers={rightLayers}
              // @ts-expect-error interleaved is valid for MapboxOverlay but missing from DeckProps
              interleaved
              onDeviceInitialized={rightState.setDevice}
            />
            {rightState.clickInfo && (
              <Popup
                longitude={rightState.clickInfo.lng}
                latitude={rightState.clickInfo.lat}
                closeOnClick={false}
                onClose={() => rightState.setClickInfo(null)}
                anchor="bottom"
              >
                <div style={{ lineHeight: 1.5 }}>
                  <div>
                    <span style={{ opacity: 0.6 }}>Value</span>{" "}
                    <strong>
                      {(rightState.clickInfo.value * rightState.selected.displayScale).toFixed(
                        rightState.selected.displayScale < 1 ? 2 : 0,
                      )}{" "}
                      {rightState.selected.units}
                    </strong>
                  </div>
                  <div>
                    <span style={{ opacity: 0.6 }}>Lat</span>{" "}
                    {rightState.clickInfo.lat.toFixed(5)}
                  </div>
                  <div>
                    <span style={{ opacity: 0.6 }}>Lon</span>{" "}
                    {rightState.clickInfo.lng.toFixed(5)}
                  </div>
                </div>
              </Popup>
            )}
          </MaplibreMap>
        </div>
      )}

      {/* Draggable divider — compare mode only */}
      {mode === "compare" && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: dividerX,
            width: "2px",
            background: "rgba(255,255,255,0.8)",
            zIndex: 500,
            cursor: "ew-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={handleDividerMouseDown}
          onTouchStart={handleDividerTouchStart}
        >
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "white",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              color: "#444",
              userSelect: "none",
              pointerEvents: "none",
            }}
          >
            ⇔
          </div>
        </div>
      )}

      {/* Left loading spinner */}
      {(leftState.tilesLoading ||
        (leftState.colormapTexture && !leftState.metadataLoaded)) && (
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: mode === "compare" ? "25%" : "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "rgba(0, 0, 0, 0.7)",
            color: "#fff",
            padding: "8px 14px",
            borderRadius: "20px",
            fontSize: "13px",
          }}
        >
          <div
            style={{
              width: "14px",
              height: "14px",
              border: "2px solid rgba(255,255,255,0.3)",
              borderTopColor: "#fff",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          {!leftState.metadataLoaded ? "Loading metadata…" : "Loading tiles…"}
        </div>
      )}

      {/* Right loading spinner — compare mode only */}
      {mode === "compare" &&
        (rightState.tilesLoading ||
          (rightState.colormapTexture && !rightState.metadataLoaded)) && (
          <div
            style={{
              position: "absolute",
              top: "20px",
              left: "75%",
              transform: "translateX(-50%)",
              zIndex: 1000,
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "rgba(0, 0, 0, 0.7)",
              color: "#fff",
              padding: "8px 14px",
              borderRadius: "20px",
              fontSize: "13px",
            }}
          >
            <div
              style={{
                width: "14px",
                height: "14px",
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: "#fff",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            {!rightState.metadataLoaded
              ? "Loading metadata…"
              : "Loading tiles…"}
          </div>
        )}

      {/* Left panel */}
      <LayerPanel
        state={leftState}
        basemap={basemap}
        onToggleBasemap={() =>
          setBasemap((b) => (b === "dark" ? "satellite" : "dark"))
        }
        side={mode === "compare" ? "left" : undefined}
        compareMode={mode === "compare"}
      />

      {/* Right panel — compare mode only */}
      {mode === "compare" && (
        <LayerPanel
          state={rightState}
          basemap={basemap}
          onToggleBasemap={() =>
            setBasemap((b) => (b === "dark" ? "satellite" : "dark"))
          }
          side="right"
          compareMode
          onMatchScale={() => {
            rightState.setRangeMin(leftState.rangeMin);
            rightState.setRangeMax(leftState.rangeMax);
          }}
          matchScaleEnabled={matchScaleEnabled}
        />
      )}

      {/* Mode toggle */}
      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1001,
          display: "flex",
          background: "white",
          borderRadius: "8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          overflow: "hidden",
        }}
      >
        {(["explore", "compare"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              padding: "6px 14px",
              fontSize: "12px",
              border: "none",
              cursor: "pointer",
              background: mode === m ? "#3b528b" : "transparent",
              color: mode === m ? "white" : "#444",
              fontWeight: mode === m ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
```

- [ ] **Step 5: Remove the now-duplicate device error block and old return**

After Step 4, `App.tsx` should have exactly one `if (leftState.deviceError)` block and one `return (...)`. Delete any leftover old return or device error block from the previous Task 3 version.

- [ ] **Step 6: Run Biome check**

```bash
pnpm check
```

Fix any issues with `pnpm check:fix`.

- [ ] **Step 7: Verify in browser — explore mode**

```bash
pnpm dev
```

Open `http://localhost:3000`. In **Explore** mode verify:
- Everything from Tasks 1–3 still works unchanged
- Mode toggle pill at top center, "Explore" highlighted

- [ ] **Step 8: Verify in browser — compare mode**

Click **Compare**. Verify:
- Two maps render, synchronized — panning one pans both
- Draggable divider is visible and responds to mouse drag; right map clips at divider
- Left panel (top-left) shows controls for left map
- Right panel (top-right) shows controls for right map with "← Match scale" button
- Each panel's source selector, sliders, and auto-scale work independently
- Match scale button is **enabled** when both sides show sources with the same units (e.g., both g-C/m²), and **disabled** when units differ (e.g., one is cm, one is g-C/m²)
- Clicking "← Match scale" (when enabled) copies left min/max to right panel sliders and updates right map colors
- Colorbar labels (min/units/max) update live on both panels as sliders move
- Click-to-query popup works on each side independently
- Loading spinners appear centered over their respective map halves
- Switching back to Explore shows only one map and one panel

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat(compare): add split-view comparison mode with draggable divider

Co-authored-by: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in |
|-----------------|-----------|
| Auto-scale button (not on every viewport change) | Task 2 — `applyAutoScale` + `pendingAutoScale` |
| Auto-scale fires on layer switch | Task 1 — `shouldAutoScaleRef` + `handleViewportLoad` |
| Min/max text at colorbar ends | Task 2 — flex row below gradient bar |
| Mode toggle button at top of page | Task 3 + Task 4 |
| Draggable swipe divider | Task 4 — `dividerX` + `clipPath` |
| Independent source selection per side | Task 4 — `leftState` + `rightState` each with own `selectedIndex` |
| Independent scale controls per side | Task 4 — each `LayerState` has own `rangeMin`/`rangeMax` |
| Match scale button | Task 2 (`LayerPanel`) + Task 4 (wiring) |
| Match scale enabled only when units match | Task 4 — `matchScaleEnabled` computed from `selected.units` comparison |
| Match scale disabled with explanation | Task 2 — `title` attribute on disabled button |

**Type consistency:** `LayerState` defined in Task 1, consumed in Tasks 2 and 4. `LayerPanelProps` defined in Task 2, used in Task 4. `TileData` defined in Task 1, used throughout `App.tsx`. All consistent.

**No placeholders:** All steps contain complete code.
