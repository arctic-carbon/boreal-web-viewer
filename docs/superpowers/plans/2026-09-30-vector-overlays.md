# Vector Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five infrastructure/place shapefile layers as a single-toggle vector overlay on top of the raster layers.

**Architecture:** Convert shapefiles to FlatGeobuf (WGS84) served by the existing local file server; load them lazily on first toggle using `@geoarrow/flatgeobuf-wasm`; render via `@geoarrow/deck.gl-geoarrow` layers appended to both DeckGL overlays; a single Show/Hide button in `LayerPanel` controls all five at once.

**Tech Stack:** `@geoarrow/deck.gl-geoarrow` v0.4.2, `@geoarrow/flatgeobuf-wasm` v0.2.0-beta.4 (ESM build), `apache-arrow`, ogr2ogr for shapefile conversion.

## Global Constraints

- pnpm 10 for package management
- Biome for lint/format — all `if` statements must use block bodies `{ }`
- No new state management libraries
- FlatGeobuf files served at `http://localhost:8080` via existing `npx serve --cors /Users/sludwig/Documents/Python/viz -l 8080`
- `VITE_DATA_BASE_URL` env var controls the base URL (same as raster tiles)
- TypeScript strict mode — no implicit `any`
- Run `pnpm check` before every commit

---

### Task 1: Convert Shapefiles to FlatGeobuf

**Files:**
- No source files modified — shell commands only
- Output: `/Users/sludwig/Documents/Python/viz/highway.fgb`, `road.fgb`, `trail.fgb`, `railroad.fgb`, `place.fgb`

**Interfaces:**
- Produces: five `.fgb` files at `http://localhost:8080/{layer}.fgb`

- [ ] **Step 1: Verify ogr2ogr is available**

```bash
ogr2ogr --version
```
Expected: `GDAL 3.x.x` or similar.

- [ ] **Step 2: Convert all five shapefiles to WGS84 FlatGeobuf**

```bash
for layer in road highway trail railroad place; do
  ogr2ogr -f FlatGeobuf -t_srs EPSG:4326 \
    /Users/sludwig/Documents/Python/viz/${layer}.fgb \
    /Users/sludwig/Documents/Python/viz/${layer}_UTM5N.shp
done
```

- [ ] **Step 3: Verify output files exist and are non-zero**

```bash
ls -lh /Users/sludwig/Documents/Python/viz/*.fgb
```
Expected: five `.fgb` files, each > 0 bytes.

- [ ] **Step 4: Spot-check one file with ogrinfo**

```bash
ogrinfo -al -so /Users/sludwig/Documents/Python/viz/road.fgb
```
Expected: geometry type `Line String` or `Multi Line String`, SRS `GEOGCS["WGS 84"...]`.

---

### Task 2: Install Packages and Create `vectorSources.ts`

**Files:**
- Modify: `package.json` (via pnpm add)
- Create: `src/vectorSources.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type VectorSource = {
    id: string;
    file: string;
    geomType: "line" | "polygon";
    color: [number, number, number, number];
    width?: number;
  };
  export const VECTOR_SOURCES: VectorSource[];
  ```

- [ ] **Step 1: Install packages**

```bash
cd /Users/sludwig/Documents/Python/denali-fire-risk
pnpm add @geoarrow/deck.gl-geoarrow @geoarrow/flatgeobuf-wasm apache-arrow
```

- [ ] **Step 2: Verify installation**

```bash
ls node_modules/@geoarrow/
ls node_modules/apache-arrow/
```
Expected: both directories present.

- [ ] **Step 3: Create `src/vectorSources.ts`**

```typescript
export type VectorSource = {
  id: string;
  file: string;
  geomType: "line" | "polygon";
  color: [number, number, number, number];
  width?: number;
};

export const VECTOR_SOURCES: VectorSource[] = [
  { id: "highway",  file: "highway.fgb",  geomType: "line",    color: [255, 200, 0,   200], width: 2   },
  { id: "road",     file: "road.fgb",     geomType: "line",    color: [200, 200, 200, 180], width: 1   },
  { id: "trail",    file: "trail.fgb",    geomType: "line",    color: [180, 120, 60,  180], width: 1   },
  { id: "railroad", file: "railroad.fgb", geomType: "line",    color: [160, 160, 220, 180], width: 1.5 },
  { id: "place",    file: "place.fgb",    geomType: "polygon", color: [100, 150, 200, 38]              },
];
```

- [ ] **Step 4: Run Biome check**

```bash
pnpm check
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/vectorSources.ts
git commit -m "feat(overlays): install geoarrow packages, add vectorSources config

Co-authored-by: Claude <noreply@anthropic.com>"
```

---

### Task 3: Create `src/hooks/useVectorOverlays.ts`

**Files:**
- Create: `src/hooks/useVectorOverlays.ts`

**Interfaces:**
- Consumes:
  - `VECTOR_SOURCES` from `../vectorSources.js`
  - `VITE_DATA_BASE_URL` env var (same base URL as raster layers)
- Produces:
  ```typescript
  export type VectorOverlayState = {
    showOverlays: boolean;
    toggleOverlays: () => void;
    overlayLayers: Layer[];
  };
  export function useVectorOverlays(): VectorOverlayState;
  ```

**Background:** `readFlatGeobuf(bytes: Uint8Array)` returns a wasm `Table` (not an apache-arrow Table). Call `.intoIPCStream()` on it to get `Uint8Array` Arrow IPC bytes, then parse with `tableFromIPC()` from `apache-arrow`. `GeoArrowPathLayer` and `GeoArrowSolidPolygonLayer` each accept a single `arrow.RecordBatch` as `data`, so iterate `jsTable.batches` to produce one layer per batch.

- [ ] **Step 1: Write `src/hooks/useVectorOverlays.ts`**

```typescript
import type { Layer } from "@deck.gl/core";
import {
  GeoArrowPathLayer,
  GeoArrowSolidPolygonLayer,
} from "@geoarrow/deck.gl-geoarrow";
import { tableFromIPC } from "apache-arrow";
import { useCallback, useRef, useState } from "react";
import { VECTOR_SOURCES } from "../vectorSources.js";

const BASE =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://data.source.coop/luddaludwig/boreal-fire-carbon";

// Module-level WASM init guard — resolves once, shared across hook instances.
let wasmReady: Promise<void> | null = null;

async function ensureWasm(): Promise<
  (bytes: Uint8Array) => { intoIPCStream(): Uint8Array }
> {
  const mod = await import("@geoarrow/flatgeobuf-wasm/esm");
  if (!wasmReady) {
    wasmReady = mod.default();
  }
  await wasmReady;
  return mod.readFlatGeobuf;
}

async function loadLayersFromSources(): Promise<Layer[]> {
  const readFlatGeobuf = await ensureWasm();
  const results = await Promise.allSettled(
    VECTOR_SOURCES.map(async (src) => {
      const url = `${BASE}/${src.file}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} for ${src.file}`);
      }
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const wasmTable = readFlatGeobuf(bytes);
      const ipcBytes = wasmTable.intoIPCStream();
      const jsTable = tableFromIPC(ipcBytes);

      const layers: Layer[] = [];
      for (let i = 0; i < jsTable.batches.length; i++) {
        const batch = jsTable.batches[i];
        if (src.geomType === "line") {
          layers.push(
            new GeoArrowPathLayer({
              id: `vector-${src.id}-${i}`,
              data: batch,
              getColor: src.color,
              getWidth: src.width ?? 1,
              widthUnits: "pixels",
              widthMinPixels: 1,
              pickable: false,
            }),
          );
        } else {
          layers.push(
            new GeoArrowSolidPolygonLayer({
              id: `vector-${src.id}-${i}`,
              data: batch,
              getFillColor: src.color,
              extruded: false,
              pickable: false,
            }),
          );
        }
      }
      return layers;
    }),
  );

  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export type VectorOverlayState = {
  showOverlays: boolean;
  toggleOverlays: () => void;
  overlayLayers: Layer[];
};

export function useVectorOverlays(): VectorOverlayState {
  const [showOverlays, setShowOverlays] = useState(false);
  const cachedLayers = useRef<Layer[] | null>(null);
  const [overlayLayers, setOverlayLayers] = useState<Layer[]>([]);

  const toggleOverlays = useCallback(() => {
    if (cachedLayers.current !== null) {
      setShowOverlays((prev) => {
        const next = !prev;
        setOverlayLayers(next ? (cachedLayers.current ?? []) : []);
        return next;
      });
      return;
    }
    // First enable — load all layers.
    setShowOverlays(true);
    loadLayersFromSources().then((layers) => {
      cachedLayers.current = layers;
      setOverlayLayers(layers);
    });
  }, []);

  return { showOverlays, toggleOverlays, overlayLayers };
}
```

- [ ] **Step 2: Run Biome check**

```bash
pnpm check
```
Expected: no errors. If formatting issues appear, run `pnpm check:fix` and review.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useVectorOverlays.ts
git commit -m "feat(overlays): add useVectorOverlays hook with lazy FlatGeobuf loading

Co-authored-by: Claude <noreply@anthropic.com>"
```

---

### Task 4: Wire `App.tsx` — Add Overlay Layers to Both Maps

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useVectorOverlays()` → `{ showOverlays, toggleOverlays, overlayLayers }` from `../hooks/useVectorOverlays.js`
- Produces: `showOverlays` and `toggleOverlays` passed to both `LayerPanel` instances; `overlayLayers` appended to both `DeckGLOverlay` `layers` props

**Key lines in `src/App.tsx` to modify:**
- Line 388: `layers={leftLayer ? [leftLayer] : []}` — left DeckGLOverlay
- Line 443: `layers={rightLayer ? [rightLayer] : []}` — right DeckGLOverlay
- Line 602: `<LayerPanel state={leftState} ...>` — left panel props
- Line 611: `<LayerPanel state={rightState} ...>` — right panel props (compare mode only)

- [ ] **Step 1: Add import for `useVectorOverlays` in `src/App.tsx`**

In the existing import block (around line 15–17), add:
```typescript
import { useVectorOverlays } from "./hooks/useVectorOverlays.js";
```

- [ ] **Step 2: Instantiate the hook in the `App` component**

In the `App()` function, after the existing `leftState` and `rightState` hook calls, add:
```typescript
const { showOverlays, toggleOverlays, overlayLayers } = useVectorOverlays();
```

- [ ] **Step 3: Update left DeckGLOverlay layers prop (line ~389)**

Change:
```tsx
layers={leftLayer ? [leftLayer] : []}
```
To:
```tsx
layers={[...(leftLayer ? [leftLayer] : []), ...overlayLayers]}
```

- [ ] **Step 4: Update right DeckGLOverlay layers prop (line ~443)**

Change:
```tsx
layers={rightLayer ? [rightLayer] : []}
```
To:
```tsx
layers={[...(rightLayer ? [rightLayer] : []), ...overlayLayers]}
```

- [ ] **Step 5: Pass overlay props to left LayerPanel (line ~602)**

Change:
```tsx
<LayerPanel
  state={leftState}
  basemap={basemap}
  onToggleBasemap={toggleBasemap}
  side={isCompare ? "left" : undefined}
  compareMode={isCompare}
/>
```
To:
```tsx
<LayerPanel
  state={leftState}
  basemap={basemap}
  onToggleBasemap={toggleBasemap}
  side={isCompare ? "left" : undefined}
  compareMode={isCompare}
  showOverlays={showOverlays}
  onToggleOverlays={toggleOverlays}
/>
```

- [ ] **Step 6: Pass overlay props to right LayerPanel (line ~611)**

Change:
```tsx
<LayerPanel
  state={rightState}
  basemap={basemap}
  onToggleBasemap={toggleBasemap}
  side="right"
  compareMode
  onMatchScale={handleMatchScale}
  matchScaleEnabled={matchScaleEnabled}
/>
```
To:
```tsx
<LayerPanel
  state={rightState}
  basemap={basemap}
  onToggleBasemap={toggleBasemap}
  side="right"
  compareMode
  onMatchScale={handleMatchScale}
  matchScaleEnabled={matchScaleEnabled}
  showOverlays={showOverlays}
  onToggleOverlays={toggleOverlays}
/>
```

- [ ] **Step 7: Run Biome check**

```bash
pnpm check
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(overlays): wire overlay layers and toggle props into App.tsx

Co-authored-by: Claude <noreply@anthropic.com>"
```

---

### Task 5: Add Toggle Button to `LayerPanel.tsx`

**Files:**
- Modify: `src/components/LayerPanel.tsx`

**Interfaces:**
- Consumes:
  - `showOverlays: boolean` — new prop
  - `onToggleOverlays: () => void` — new prop
- The toggle button sits between the basemap toggle and the opacity slider, matching the existing basemap button style (full-width, `#f0f0f0` background, `12px` font).

**Key location:** Find the basemap toggle button block in `LayerPanel.tsx`. Insert the overlays toggle immediately after it and before the opacity slider section.

- [ ] **Step 1: Add new props to `LayerPanelProps` in `src/components/LayerPanel.tsx`**

Extend the existing `LayerPanelProps` type:
```typescript
export type LayerPanelProps = {
  state: LayerState;
  basemap: BasemapKey;
  onToggleBasemap: () => void;
  side?: "left" | "right";
  compareMode?: boolean;
  onMatchScale?: () => void;
  matchScaleEnabled?: boolean;
  showOverlays: boolean;
  onToggleOverlays: () => void;
};
```

- [ ] **Step 2: Destructure the new props in the function signature**

In the `LayerPanel` function signature, add `showOverlays` and `onToggleOverlays` to the destructured params:
```typescript
export function LayerPanel({
  state,
  basemap,
  onToggleBasemap,
  side,
  compareMode = false,
  onMatchScale,
  matchScaleEnabled = false,
  showOverlays,
  onToggleOverlays,
}: LayerPanelProps) {
```

- [ ] **Step 3: Add the toggle button JSX after the basemap toggle button**

Find the basemap toggle button (it has `onClick={onToggleBasemap}`). Immediately after that `<button>` closing tag, insert:
```tsx
<button
  type="button"
  onClick={onToggleOverlays}
  style={{
    width: "100%",
    padding: "6px 10px",
    fontSize: "12px",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    background: showOverlays ? "#3b528b" : "#f0f0f0",
    color: showOverlays ? "white" : "#333",
    textAlign: "left" as const,
  }}
>
  {showOverlays ? "Hide overlays" : "Show overlays"}
</button>
```

- [ ] **Step 4: Run Biome check**

```bash
pnpm check
```
Expected: no errors. If formatting issues, run `pnpm check:fix`.

- [ ] **Step 5: Manual test — start dev server and verify**

```bash
pnpm dev
```

Open `http://localhost:3000` in the browser. Verify:
1. "Show overlays" button appears in the layer panel.
2. Clicking it changes the label to "Hide overlays" and roads/trails/etc appear on the map.
3. Clicking again hides the overlays.
4. Switching to compare mode — both panels have the button; toggling in either toggles both maps (shared state from the hook).

- [ ] **Step 6: Commit**

```bash
git add src/components/LayerPanel.tsx
git commit -m "feat(overlays): add Show/Hide overlays toggle to LayerPanel

Co-authored-by: Claude <noreply@anthropic.com>"
```
