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
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, Popup, useControl } from "react-map-gl/maplibre";
import { LayerPanel } from "./components/LayerPanel.js";
import type { TileData } from "./hooks/useLayerState.js";
import { useLayerState } from "./hooks/useLayerState.js";

function DeckGLOverlay(props: DeckProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// ---- Basemap styles ----
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

// Concurrent in-flight tile fetches. HTTP/2 + the `cache: "no-store"`
// override above let us run more in parallel without hitting the Chromium
// cache-lock serialization. -1 disables the cap.
const MAX_TILE_REQUESTS = 20;

// ---- Custom shader: rescale r16unorm value to [0,1] using min/max ----
// r16unorm maps 0..65535 → 0.0..1.0, so rawValue = color.r * 65535.0
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
      // Treat 0 as nodata
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

/** Set alpha to 1.0 (data has no alpha channel) */
const SetAlpha1 = {
  name: "set-alpha-1",
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      color = vec4(color.rgb, 1.0);
    `,
  },
} as const satisfies ShaderModule;

type GeoTIFFLoadHandler = ReturnType<typeof useLayerState>["handleGeoTIFFLoad"];

function buildCOGLayer(
  id: string,
  state: ReturnType<typeof useLayerState>,
  basemap: BasemapKey,
  onGeoTIFFLoad?: GeoTIFFLoadHandler,
): COGLayer<TileData> | null {
  if (!state.colormapTexture || !state.selected.url) {
    return null;
  }
  const colormapTexture = state.colormapTexture;
  return new COGLayer<TileData>({
    id,
    opacity: state.dataOpacity,
    geotiff: state.selected.url,
    maxRequests: MAX_TILE_REQUESTS,
    getTileData: state.trackingGetTileData,
    renderTile: (tileData: TileData): RenderTileResult => ({
      renderPipeline: [
        {
          module: CreateTexture,
          props: { textureName: tileData.texture },
        },
        {
          module: Rescale,
          props: {
            rangeMin: state.rangeMin,
            rangeMax: state.rangeMax,
          },
        },
        {
          module: Colormap,
          props: {
            colormapTexture,
            colormapIndex: 0,
          },
        },
        {
          module: SetAlpha1,
        },
      ],
    }),
    onGeoTIFFLoad: onGeoTIFFLoad ?? state.handleGeoTIFFLoad,
    onViewportLoad: state.handleViewportLoad,
    ...(basemap === "dark" && { beforeId: "boundary_country_outline" }),
  });
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const hasInitialFitRef = useRef(false);
  const [basemap, setBasemap] = useState<BasemapKey>("dark");
  const [mode, setMode] = useState<"explore" | "compare">("explore");
  const [viewState, setViewState] = useState({
    longitude: -112.5,
    latitude: 60,
    zoom: 3,
    pitch: 0 as number,
    bearing: 0 as number,
  });
  const [dividerX, setDividerX] = useState(() => window.innerWidth / 2);
  const isDraggingRef = useRef(false);

  const leftState = useLayerState();
  const rightState = useLayerState(1);

  // Inject @keyframes spin CSS (project uses no CSS files)
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Reset divider to center when entering compare mode
  useEffect(() => {
    if (mode === "compare") {
      setDividerX(window.innerWidth / 2);
    }
  }, [mode]);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) {
        return;
      }
      setDividerX(Math.max(50, Math.min(window.innerWidth - 50, ev.clientX)));
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  const handleDividerTouchStart = useCallback((_e: React.TouchEvent) => {
    isDraggingRef.current = true;

    const onTouchMove = (ev: TouchEvent) => {
      if (!isDraggingRef.current || !ev.touches[0]) {
        return;
      }
      setDividerX(
        Math.max(50, Math.min(window.innerWidth - 50, ev.touches[0].clientX)),
      );
    };
    const onTouchEnd = () => {
      isDraggingRef.current = false;
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
    document.addEventListener("touchmove", onTouchMove);
    document.addEventListener("touchend", onTouchEnd);
  }, []);

  const leftLayer = buildCOGLayer(
    "cog-layer-left",
    leftState,
    basemap,
    (tiff, options) => {
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
  );

  const rightLayer =
    mode === "compare"
      ? buildCOGLayer("cog-layer-right", rightState, basemap)
      : null;

  const matchScaleEnabled =
    leftState.selected.units === rightState.selected.units;

  const handleMatchScale = useCallback(() => {
    rightState.setRangeMin(leftState.rangeMin);
    rightState.setRangeMax(leftState.rangeMax);
  }, [rightState, leftState.rangeMin, leftState.rangeMax]);

  const toggleBasemap = useCallback(
    () => setBasemap((b) => (b === "dark" ? "satellite" : "dark")),
    [],
  );

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

  const mapStyle = BASEMAPS[basemap] as string;
  const isCompare = mode === "compare";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Left map — always full screen, renders underneath */}
      <div style={{ position: "absolute", inset: 0 }}>
        <MaplibreMap
          ref={mapRef}
          {...viewState}
          onMove={(e) => setViewState(e.viewState)}
          mapStyle={mapStyle}
          onClick={leftState.handleMapClick}
        >
          <DeckGLOverlay
            layers={leftLayer ? [leftLayer] : []}
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
                    {(
                      leftState.clickInfo.value *
                      leftState.selected.displayScale
                    ).toFixed(leftState.selected.displayScale < 1 ? 2 : 0)}{" "}
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
      </div>

      {/* Right map — clipped to the right of the divider, compare mode only */}
      {isCompare && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `inset(0 0 0 ${dividerX}px)`,
          }}
        >
          <MaplibreMap
            {...viewState}
            onMove={(e) => setViewState(e.viewState)}
            mapStyle={mapStyle}
            onClick={rightState.handleMapClick}
          >
            <DeckGLOverlay
              layers={rightLayer ? [rightLayer] : []}
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
                      {(
                        rightState.clickInfo.value *
                        rightState.selected.displayScale
                      ).toFixed(
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

      {/* Draggable divider */}
      {isCompare && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${dividerX}px`,
            width: "2px",
            background: "rgba(255,255,255,0.8)",
            zIndex: 500,
            cursor: "col-resize",
            transform: "translateX(-50%)",
          }}
        >
          {/* Drag handle */}
          <button
            type="button"
            aria-label="Drag to adjust split"
            onMouseDown={handleDividerMouseDown}
            onTouchStart={handleDividerTouchStart}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              background: "white",
              border: "none",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              cursor: "col-resize",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              color: "#666",
              padding: 0,
            }}
          >
            &#8596;
          </button>
        </div>
      )}

      {/* Left loading spinner */}
      {(leftState.tilesLoading ||
        (leftState.colormapTexture && !leftState.metadataLoaded)) && (
        <div
          style={{
            position: "absolute",
            top: "20px",
            left: isCompare ? "25%" : "50%",
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
      {isCompare &&
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
        onToggleBasemap={toggleBasemap}
        side={isCompare ? "left" : undefined}
        compareMode={isCompare}
      />

      {/* Right panel — compare mode only */}
      {isCompare && (
        <LayerPanel
          state={rightState}
          basemap={basemap}
          onToggleBasemap={toggleBasemap}
          side="right"
          compareMode
          onMatchScale={handleMatchScale}
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
}
