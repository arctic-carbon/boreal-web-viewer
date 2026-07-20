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

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const hasInitialFitRef = useRef(false);
  const [basemap, setBasemap] = useState<BasemapKey>("dark");

  const leftState = useLayerState();
  const layers: COGLayer<TileData>[] = [];

  // Inject @keyframes spin CSS (project uses no CSS files)
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
            // colormapTexture is non-null here: guarded by outer if(leftState.colormapTexture)
            props: {
              colormapTexture: leftState.colormapTexture!,
              colormapIndex: 0,
            },
          },
          {
            module: SetAlpha1,
          },
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
                  {(
                    leftState.clickInfo.value * leftState.selected.displayScale
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

      <LayerPanel
        state={leftState}
        basemap={basemap}
        onToggleBasemap={() =>
          setBasemap((b) => (b === "dark" ? "satellite" : "dark"))
        }
      />
    </div>
  );
}
