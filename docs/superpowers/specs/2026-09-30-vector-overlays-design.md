# Vector Overlays Design

**Date:** 2026-09-30
**Branch:** denali-data
**Scope:** Add five shapefile layers (road, highway, trail, railroad, place) as a single toggleable overlay using deck.gl-geoarrow and FlatGeobuf.

## Goal

Display infrastructure and place-boundary vector layers on top of the raster layers, controlled by a single on/off toggle in the layer panel.

## Non-goals

- Per-layer visibility controls
- Attribute popups on vector feature click
- Uploading vector files to source.coop (local serving only for now)
- Style customization in the UI

## Data Preparation

Convert the five shapefiles from NAD27/UTM zone 5N to WGS84 FlatGeobuf using ogr2ogr. Output files go into `/Users/sludwig/Documents/Python/viz/` so the existing CORS file server (port 8080) serves them automatically.

```bash
for layer in road highway trail railroad place; do
  ogr2ogr -f FlatGeobuf -t_srs EPSG:4326 \
    /Users/sludwig/Documents/Python/viz/${layer}.fgb \
    /Users/sludwig/Documents/Python/viz/${layer}_UTM5N.shp
done
```

Output files: `road.fgb`, `highway.fgb`, `trail.fgb`, `railroad.fgb`, `place.fgb`

The same `VITE_DATA_BASE_URL` env var used for raster tiles controls the base path for these files.

## Packages

```
@geoarrow/deck.gl-geoarrow
@geoarrow/flatgeobuf-wasm
```

## Architecture

### `src/vectorSources.ts` (new)

Static config for the five overlay layers — name, file path, geometry type, and render style. No runtime state.

```typescript
export type VectorSource = {
  id: string;
  file: string;        // basename, e.g. "road.fgb"
  geomType: "line" | "polygon";
  color: [number, number, number, number]; // RGBA
  width?: number;       // pixels, line layers only
};

export const VECTOR_SOURCES: VectorSource[] = [
  { id: "highway",  file: "highway.fgb",  geomType: "line",    color: [255, 200, 0,   200], width: 2   },
  { id: "road",     file: "road.fgb",     geomType: "line",    color: [200, 200, 200, 180], width: 1   },
  { id: "trail",    file: "trail.fgb",    geomType: "line",    color: [180, 120, 60,  180], width: 1   },
  { id: "railroad", file: "railroad.fgb", geomType: "line",    color: [160, 160, 220, 180], width: 1.5 },
  { id: "place",    file: "place.fgb",    geomType: "polygon", color: [100, 150, 200, 38]             },
];
```

### `src/hooks/useVectorOverlays.ts` (new)

Manages toggle state and data loading. Fetches all five files once on first enable; caches the GeoArrow tables in a ref so toggling off/on is instant.

```typescript
export type VectorOverlayState = {
  showOverlays: boolean;
  toggleOverlays: () => void;
  overlayLayers: Layer[];   // deck.gl Layer instances, empty when hidden
};

export function useVectorOverlays(): VectorOverlayState;
```

Loading flow:
1. On first `toggleOverlays()` call, fetch all `.fgb` URLs in parallel.
2. Parse each with `@geoarrow/flatgeobuf-wasm` → GeoArrow Table (stored in a `useRef`).
3. Build deck.gl layer objects from the tables.
4. Subsequent toggles only flip `showOverlays` — no re-fetch.
5. WASM module initialized once with a module-level `await init()` guarded by a Promise.

Error handling: individual fetch failures are silently skipped (layer omitted); no global error state needed for a non-critical overlay.

### `src/App.tsx` (modify)

- Import `useVectorOverlays` hook.
- Add `overlayLayers` to both DeckGLOverlay `layers` props:
  ```tsx
  layers={[...(leftLayer ? [leftLayer] : []), ...overlayLayers]}
  ```
  Both maps in compare mode receive the same overlay layers.
- Pass `showOverlays` and `toggleOverlays` to both `LayerPanel` instances.

### `src/components/LayerPanel.tsx` (modify)

Add two props:
```typescript
showOverlays: boolean;
onToggleOverlays: () => void;
```

Render a toggle button between the basemap toggle and opacity slider:
```tsx
<button onClick={onToggleOverlays} ...>
  {showOverlays ? "Hide overlays" : "Show overlays"}
</button>
```

Same style as the existing basemap toggle button (full-width, `#f0f0f0` background).

## Layer Rendering

| Source | deck.gl Layer | Key props |
|---|---|---|
| line layers | `GeoArrowPathLayer` | `getPath=geometry col`, `getColor`, `getWidth`, `widthUnits:"pixels"`, `widthMinPixels:1` |
| place | `GeoArrowSolidPolygonLayer` | `getPolygon=geometry col`, `getFillColor`, `extruded:false` |

All layers: `pickable: false` (no click handling needed).

## Geometry column access

```typescript
import { tableFromIPC } from "apache-arrow";  // not needed — flatgeobuf-wasm returns Table directly
const table = readFlatGeobuf(buffer);          // returns GeoArrow Table
const geomCol = table.getChild("geometry");    // Arrow ChunkedArray
```

## Layer ordering

Vector overlays are appended after the raster COGLayer so they render on top. In interleaved mode (MapLibre), they sit above the raster but still respect MapLibre's layer order — the existing `beforeId: "boundary_country_outline"` on the COGLayer is unaffected.
