import { SourceHttp } from "@chunkd/source-http";
import type { DeckProps } from "@deck.gl/core";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { COGLayer } from "@developmentseed/deck.gl-geotiff";
import type { RenderTileResult } from "@developmentseed/deck.gl-raster";
import {
  Colormap,
  CreateTexture,
  createColormapTexture,
} from "@developmentseed/deck.gl-raster/gpu-modules";
import type { Overview } from "@developmentseed/geotiff";
import { GeoTIFF } from "@developmentseed/geotiff";
import type { Device, Texture } from "@luma.gl/core";
import type { ShaderModule } from "@luma.gl/shadertools";
import "maplibre-gl/dist/maplibre-gl.css";
import proj4 from "proj4";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import { Map as MaplibreMap, Popup, useControl } from "react-map-gl/maplibre";
import colormap from "./colormap.js";

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

// ---- Data source (Int16 COG on source.coop) ----
// Use the data.source.coop hostname rather than the raw S3 URL: it serves
// HTTP/2, so the browser can multiplex many range requests over one
// connection. The raw S3 host is HTTP/1.1 only, which caps parallelism at
// 6 sockets per origin no matter what `maxRequests` is set to.
const COG_URL =
  "https://data.source.coop/luddaludwig/boreal-fire-carbon/AGC_ssp585.tif";

// Bypass Chrome's single-writer cache lock on range requests to avoid
// serialized tile fetches (see Chromium disk cache locking behavior).
// Scoped to SourceHttp only — does not affect MapLibre or other fetches.
SourceHttp.fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

const cogPromise = GeoTIFF.fromUrl(COG_URL);

// ---- Data range (from gdalinfo: Min=0, Max=4102 for the unsigned version) ----
// The Int16 source has the same value range; negative values are nodata/unused.
const DATA_MIN = 0;
const DATA_MAX = 4102;

// Concurrent in-flight tile fetches. Default in deck.gl's TileLayer is 6
// (historical per-host HTTP/1.1 limit). HTTP/2 + the `cache: "no-store"`
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
    rangeMin: props.rangeMin ?? DATA_MIN,
    rangeMax: props.rangeMax ?? DATA_MAX,
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

// ---- Custom tile data type ----
type TileData = {
  height: number;
  width: number;
  texture: Texture;
};

/**
 * Pad 16-bit data rows to 4-byte alignment for WebGL's UNPACK_ALIGNMENT.
 * For single-channel r16unorm, each row is width*2 bytes. If not divisible
 * by 4 (i.e., odd width), we must pad each row.
 */
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

/** Custom tile loader for single-band Int16 data.
 *  Uploads as r16unorm (reinterprets bits as unsigned). Since actual values
 *  are positive (0–4102), this avoids an Int16→Float32 copy. */
async function getTileData(
  image: GeoTIFF | Overview,
  options: { device: Device; x: number; y: number; signal?: AbortSignal },
): Promise<TileData> {
  const { device, x, y, signal } = options;
  const tile = await image.fetchTile(x, y, { signal, boundless: false });
  const { width, height } = tile.array;
  const data = "data" in tile.array ? tile.array.data : tile.array.bands[0]!;

  // Reinterpret Int16 bits as Uint16 for r16unorm upload, with row alignment
  const uint16 = new Uint16Array(data.buffer, data.byteOffset, data.length);
  const aligned = padRows(uint16, width, height);

  const texture = device.createTexture({
    data: aligned,
    format: "r16unorm",
    width,
    height,
    sampler: {
      minFilter: "nearest",
      magFilter: "nearest",
    },
  });

  return { texture, height, width };
}

export default function App() {
  const mapRef = useRef<MapRef>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [colormapTexture, setColormapTexture] = useState<Texture | null>(null);
  const [rangeMin, setRangeMin] = useState(DATA_MIN);
  const [rangeMax, setRangeMax] = useState(DATA_MAX);
  const [basemap, setBasemap] = useState<BasemapKey>("dark");
  const [dataOpacity, setDataOpacity] = useState(1);
  const [cog, setCog] = useState<GeoTIFF | null>(null);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [tilesLoading, setTilesLoading] = useState(false);
  const loadingCountRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 768);
  const [clickInfo, setClickInfo] = useState<{
    lng: number;
    lat: number;
    value: number;
  } | null>(null);
  const geotiffRef = useRef<{
    geotiff: GeoTIFF;
    toSourceCRS: (lng: number, lat: number) => [number, number];
  } | null>(null);

  // Wrap getTileData to track in-flight tile requests
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

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  // Inject @keyframes spin CSS (project uses no CSS files)
  useEffect(() => {
    cogPromise.then(setCog);
  }, []);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

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

  // Validate device capabilities and create colormap texture
  useEffect(() => {
    if (!device) {
      return;
    }

    // Check for r16unorm support (requires EXT_texture_norm16 in WebGL)
    if (!device.features.has("norm16-renderable-webgl")) {
      setDeviceError(
        "This application requires advanced graphics features that are not available in your current browser. Please try opening it in Chrome, Edge, or Brave instead.",
      );
      return;
    }

    // Colormap module in 0.7.0 expects a 2D-array texture (one layer per
    // colormap); `createColormapTexture` packs an ImageData row-per-layer.
    // Our `colormap` ImageData has height 1, so the result has a single
    // layer at index 0.
    setColormapTexture(createColormapTexture(device, colormap));
  }, [device]);

  const layers = [];

  if (colormapTexture && cog) {
    const cogLayer = new COGLayer<TileData>({
      id: "agc-layer",
      opacity: dataOpacity,
      geotiff: cog,
      maxRequests: MAX_TILE_REQUESTS,
      getTileData: trackingGetTileData,
      renderTile: (tileData: TileData): RenderTileResult => ({
        renderPipeline: [
          {
            module: CreateTexture,
            props: { textureName: tileData.texture },
          },
          {
            module: Rescale,
            props: { rangeMin, rangeMax },
          },
          {
            module: Colormap,
            props: { colormapTexture, colormapIndex: 0 },
          },
          {
            module: SetAlpha1,
          },
        ],
      }),
      onGeoTIFFLoad: (tiff, options) => {
        setMetadataLoaded(true);
        // The parsed ProjectionDefinition from @developmentseed/proj is
        // runtime-compatible with proj4.Proj, but its type lacks the
        // forward/inverse methods that proj4's ProjectionDefinition type
        // declares (those are attached during Proj construction).
        const sourceProj = new proj4.Proj(
          options.projection as unknown as proj4.ProjectionDefinition,
        );
        const converter = proj4("EPSG:4326", sourceProj);
        geotiffRef.current = {
          geotiff: tiff,
          toSourceCRS: (lng, lat) =>
            converter.forward<[number, number]>([lng, lat], false),
        };

        const { west, south, east, north } = options.geographicBounds;
        mapRef.current?.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 40, duration: 1000 },
        );
      },
      ...(basemap === "dark" && { beforeId: "boundary_country_outline" }),
    });
    layers.push(cogLayer);
  }

  if (deviceError) {
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
          <p style={{ color: "#666" }}>{deviceError}</p>
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
        onClick={handleMapClick}
      >
        <DeckGLOverlay
          layers={layers}
          // @ts-expect-error interleaved is valid for MapboxOverlay but missing from DeckProps
          interleaved
          onDeviceInitialized={setDevice}
        />
        {clickInfo && (
          <Popup
            longitude={clickInfo.lng}
            latitude={clickInfo.lat}
            closeOnClick={false}
            onClose={() => setClickInfo(null)}
            anchor="bottom"
          >
            <div style={{ lineHeight: 1.5 }}>
              <div>
                <span style={{ opacity: 0.6 }}>Value</span>{" "}
                <strong>{clickInfo.value}</strong>
              </div>
              <div>
                <span style={{ opacity: 0.6 }}>Lat</span>{" "}
                {clickInfo.lat.toFixed(5)}
              </div>
              <div>
                <span style={{ opacity: 0.6 }}>Lon</span>{" "}
                {clickInfo.lng.toFixed(5)}
              </div>
            </div>
          </Popup>
        )}
      </MaplibreMap>

      {/* Loading spinner */}
      {(tilesLoading || (colormapTexture && !metadataLoaded)) && (
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
          {!metadataLoaded ? "Loading metadata…" : "Loading tiles…"}
        </div>
      )}

      {/* Panel toggle button (visible when collapsed) */}
      {!panelOpen && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
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
      {panelOpen && (
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
                Potential Above-Ground Combustion
              </h3>
              <p
                style={{
                  margin: "0 0 12px 0",
                  fontSize: "12px",
                  color: "#666",
                }}
              >
                Boreal and Arctic North America — SSP585
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
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
              Min: {rangeMin}
              <input
                type="range"
                min={DATA_MIN}
                max={DATA_MAX}
                step={1}
                value={rangeMin}
                onChange={(e) =>
                  setRangeMin(
                    Math.min(parseFloat(e.target.value), rangeMax - 1),
                  )
                }
                style={{ width: "100%", cursor: "pointer" }}
              />
            </label>
          </div>

          {/* Max slider */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "2px",
              }}
            >
              Max: {rangeMax}
              <input
                type="range"
                min={DATA_MIN}
                max={DATA_MAX}
                step={1}
                value={rangeMax}
                onChange={(e) =>
                  setRangeMax(
                    Math.max(parseFloat(e.target.value), rangeMin + 1),
                  )
                }
                style={{ width: "100%", cursor: "pointer" }}
              />
            </label>
          </div>

          {/* Basemap toggle */}
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

          {/* Data opacity slider */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "2px",
              }}
            >
              Data Opacity: {Math.round(dataOpacity * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={dataOpacity}
                onChange={(e) => setDataOpacity(parseFloat(e.target.value))}
                style={{ width: "100%", cursor: "pointer" }}
              />
            </label>
          </div>

          {/* Colormap gradient preview */}
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
            g‑C/m<sup>2</sup>
          </p>

          <p style={{ margin: 0, fontSize: "11px", color: "#999" }}>
            Data:{" "}
            <a
              href="https://source.coop/luddaludwig/potential-agc-combustion-ssp585-v0"
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
