# Phase 2: Float32 and Byte Render Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix incorrect rendering of Float32 (fire_risk) and Byte (landcover) layers by threading `dataType` and `selectedBand` through the tile loader, adding two shader modules, and adding a band selector to the layer panel.

**Architecture:** Three self-contained changes in dependency order: (1) `useLayerState.ts` generalizes the tile loader and adds band state; (2) `App.tsx` adds two shader modules and selects the right one per layer; (3) `LayerPanel.tsx` shows a band selector when the loaded layer has more than one band. Tasks 1 and 2 can be done in either order — neither is testable in isolation, but both are needed before any Float32/Byte layer renders correctly. Task 3 depends on Task 1.

**Tech Stack:** Vite 7, React 19, TypeScript strict, luma.gl 9.3.x (`r8unorm`/`r16unorm`/`r32float` texture formats), `@developmentseed/deck.gl-raster` 0.7.0, Biome for lint+format. No unit test framework — verification is `pnpm check` + manual browser smoke test.

## Global Constraints

- Run `pnpm check` before every commit — Biome errors are blocking
- Run `pnpm check:fix` to auto-fix formatting issues, then re-run `pnpm check`
- No new dependencies
- Do not add new files — all changes are edits to existing files
- Commit messages: Conventional Commits, ≤ 72 chars, imperative mood, `Co-authored-by: Claude <noreply@anthropic.com>` trailer
- `pnpm dev` uses a running local file server: `npx serve --cors /Users/sludwig/Documents/Python/viz -l 8080` and `.env.local` containing `VITE_DATA_BASE_URL=http://localhost:8080`

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/hooks/useLayerState.ts` | Modify | `padRows` generalized; `TileData.rawData` widened; `getTileData` gains `dataType`+`band`; `computeAutoScale` skips non-uint16; `trackingGetTileData` captures `dataType`+`selectedBand`; `handleMapClick` fixes nodata+band; new `selectedBand`/`setBand`/`bandCount` state |
| `src/App.tsx` | Modify | `RescaleFloat32` and `RescaleByte` shader modules added; `buildCOGLayer` selects shader by `dataType` |
| `src/components/LayerPanel.tsx` | Modify | Band selector rendered when `state.bandCount > 1` |

---

## Task 1: Generalize tile loader and add band state (`useLayerState.ts`)

**Files:**
- Modify: `src/hooks/useLayerState.ts`

**Interfaces:**
- Produces:
  - `TileData.rawData: Uint16Array | Float32Array | Uint8Array`
  - `getTileData(image, { device, x, y, signal?, dataType?, band? }): Promise<TileData>`
  - `LayerState` gains `selectedBand: number`, `setBand: (b: number) => void`, `bandCount: number`

---

- [ ] **Step 1: Widen `TileData.rawData` type**

Replace the `TileData` type definition (lines 11–16):

```typescript
export type TileData = {
  height: number;
  width: number;
  texture: Texture;
  rawData: Uint16Array | Float32Array | Uint8Array;
};
```

- [ ] **Step 2: Replace `padRows` with a generalized version**

Replace the entire `padRows` function (lines 18–37) with:

```typescript
function padRows(
  data: Uint16Array | Float32Array | Uint8Array,
  width: number,
  height: number,
  bytesPerElement: number,
): Uint16Array | Float32Array | Uint8Array {
  const rowBytes = width * bytesPerElement;
  const alignedRowBytes = Math.ceil(rowBytes / 4) * 4;
  if (alignedRowBytes === rowBytes) return data;
  const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const dst = new Uint8Array(alignedRowBytes * height);
  for (let r = 0; r < height; r++) {
    dst.set(
      src.subarray(r * rowBytes, (r + 1) * rowBytes),
      r * alignedRowBytes,
    );
  }
  if (data instanceof Float32Array) return new Float32Array(dst.buffer);
  if (data instanceof Uint8Array) return new Uint8Array(dst.buffer);
  return new Uint16Array(dst.buffer);
}
```

- [ ] **Step 3: Replace `getTileData` with the multi-type version**

Replace the entire `getTileData` function (lines 58–76):

```typescript
export async function getTileData(
  image: GeoTIFF | Overview,
  options: {
    device: Device;
    x: number;
    y: number;
    signal?: AbortSignal;
    dataType?: "uint16" | "float32" | "byte";
    band?: number;
  },
): Promise<TileData> {
  const { device, x, y, signal, dataType = "uint16", band = 0 } = options;
  const tile = await fetchTileWithRetry(image, x, y, signal);
  const { width, height } = tile.array;
  const raw =
    "data" in tile.array
      ? tile.array.data
      : (tile.array.bands[band] ?? tile.array.bands[0]!);

  if (dataType === "float32") {
    const typed = new Float32Array(raw.buffer, raw.byteOffset, raw.length);
    const aligned = padRows(typed, width, height, 4) as Float32Array;
    const texture = device.createTexture({
      data: aligned,
      format: "r32float",
      width,
      height,
      sampler: { minFilter: "nearest", magFilter: "nearest" },
    });
    return { texture, height, width, rawData: typed };
  }

  if (dataType === "byte") {
    const typed = new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
    const aligned = padRows(typed, width, height, 1) as Uint8Array;
    const texture = device.createTexture({
      data: aligned,
      format: "r8unorm",
      width,
      height,
      sampler: { minFilter: "nearest", magFilter: "nearest" },
    });
    return { texture, height, width, rawData: typed };
  }

  // uint16 — existing path unchanged
  const uint16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.length);
  const aligned = padRows(uint16, width, height, 2) as Uint16Array;
  const texture = device.createTexture({
    data: aligned,
    format: "r16unorm",
    width,
    height,
    sampler: { minFilter: "nearest", magFilter: "nearest" },
  });
  return { texture, height, width, rawData: uint16 };
}
```

- [ ] **Step 4: Add early return to `computeAutoScale` for non-uint16**

Insert these two lines at the very top of `computeAutoScale`, before the `const hist` line:

```typescript
const first = (tiles[0]?.data as TileData | null | undefined)?.rawData;
if (!first || !(first instanceof Uint16Array)) return null;
```

- [ ] **Step 5: Add `selectedBand` and `bandCount` state to `useLayerState`**

Inside `useLayerState`, after the existing state declarations (after line ~182, near the other `useState` calls), add:

```typescript
const [selectedBand, setSelectedBand] = useState(0);
const [bandCount, setBandCount] = useState(1);
```

- [ ] **Step 6: Reset `selectedBand` and `bandCount` when layer changes**

In the `useEffect` that resets `rangeMin`/`rangeMax` on `selectedIndex` change, add two lines so the full effect body is:

```typescript
useEffect(() => {
  setRangeMin(SOURCES[selectedIndex]!.dataMin);
  setRangeMax(SOURCES[selectedIndex]!.dataMax);
  setMetadataLoaded(false);
  setClickInfo(null);
  setSelectedBand(0);
  setBandCount(1);
  shouldAutoScaleRef.current = true;
  setPendingAutoScale(null);
}, [selectedIndex]);
```

- [ ] **Step 7: Set `bandCount` from GeoTIFF metadata in `handleGeoTIFFLoad`**

Replace `handleGeoTIFFLoad` (lines ~263–288) with the version that calls `setBandCount`. The `tiff.count` getter returns the number of bands:

```typescript
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
    setBandCount(tiff.count ?? 1);
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
```

- [ ] **Step 8: Update `trackingGetTileData` to pass `dataType` and `band`**

Replace the `trackingGetTileData` `useCallback` (lines ~220–238). The closure now captures `selected.dataType` and `selectedBand`, injecting them into every `getTileData` call:

```typescript
const trackingGetTileData: typeof getTileData = useCallback(
  async (image, options) => {
    loadingCountRef.current++;
    if (loadingCountRef.current === 1) {
      clearTimeout(hideTimerRef.current);
      setTilesLoading(true);
    }
    try {
      return await getTileData(image, {
        ...options,
        dataType: selected.dataType,
        band: selectedBand,
      });
    } finally {
      loadingCountRef.current--;
      if (loadingCountRef.current === 0) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setTilesLoading(false), 150);
      }
    }
  },
  // biome-ignore lint/correctness/useExhaustiveDependencies: selected is derived from SOURCES[selectedIndex], not direct state
  [selected.dataType, selectedBand],
);
```

- [ ] **Step 9: Fix `handleMapClick` to use correct band and nodata check**

Replace `handleMapClick` (lines ~290–318). It now reads the selected band and uses `Number.isNaN` for Float32 nodata:

```typescript
const handleMapClick = useCallback(
  async (e: MapLayerMouseEvent) => {
    const ref = geotiffRef.current;
    if (!ref) {
      return;
    }
    const { geotiff, toSourceCRS } = ref;
    const [x, y] = toSourceCRS(e.lngLat.lng, e.lngLat.lat);
    const [row, col] = geotiff.index(x, y);
    if (
      row < 0 ||
      row >= geotiff.height ||
      col < 0 ||
      col >= geotiff.width
    ) {
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
        "data" in tile.array
          ? tile.array.data
          : (tile.array.bands[selectedBand] ?? tile.array.bands[0]!);
      const value = arr[py * tile.array.width + px]!;
      const isNodata =
        selected.dataType === "float32" ? Number.isNaN(value) : value === 0;
      if (isNodata) {
        setClickInfo(null);
      } else {
        setClickInfo({ lng: e.lngLat.lng, lat: e.lngLat.lat, value });
      }
    } catch {
      setClickInfo(null);
    }
  },
  // biome-ignore lint/correctness/useExhaustiveDependencies: selected is derived from SOURCES[selectedIndex], not direct state
  [selected.dataType, selectedBand],
);
```

- [ ] **Step 10: Add `selectedBand`, `setBand`, `bandCount` to `LayerState` interface**

In the `LayerState` type (lines ~124–161), add three new members anywhere in the body:

```typescript
selectedBand: number;
setBand: (b: number) => void;
bandCount: number;
```

- [ ] **Step 11: Include new state in the `return` statement**

At the bottom of `useLayerState`, in the returned object, add:

```typescript
selectedBand,
setBand: setSelectedBand,
bandCount,
```

- [ ] **Step 12: Run `pnpm check` and fix any errors**

```bash
pnpm check
```

If formatting issues appear: `pnpm check:fix && pnpm check`.

- [ ] **Step 13: Commit**

```bash
git add src/hooks/useLayerState.ts
git commit -m "$(cat <<'EOF'
feat(tiles): support float32/byte tile loading and band selection

Co-authored-by: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add Float32 and Byte shader modules (`App.tsx`)

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `state.selected.dataType: "uint16" | "float32" | "byte"` (from `LayerSource`, already on `SOURCES` entries since Phase 1)
- Produces: `RescaleFloat32`, `RescaleByte` shader modules; `buildCOGLayer` selects shader by `dataType`

---

- [ ] **Step 1: Add `RescaleFloat32` shader module**

Insert after the closing `} as const satisfies ShaderModule<RescaleProps>;` of the existing `Rescale` module (after line 97), before `SetAlpha1`:

```typescript
const RescaleFloat32 = {
  name: "rescale-float32",
  fs: `\
uniform rescaleUniforms {
  float rangeMin;
  float rangeMax;
} rescale;
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float rawValue = color.r;
      if (isnan(rawValue)) discard;
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
    rangeMax: props.rangeMax ?? 1,
  }),
} as const satisfies ShaderModule<RescaleProps>;
```

- [ ] **Step 2: Add `RescaleByte` shader module**

Insert immediately after `RescaleFloat32`:

```typescript
const RescaleByte = {
  name: "rescale-byte",
  fs: `\
uniform rescaleUniforms {
  float rangeMin;
  float rangeMax;
} rescale;
`,
  inject: {
    "fs:DECKGL_FILTER_COLOR": /* glsl */ `
      float rawValue = color.r * 255.0;
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
    rangeMax: props.rangeMax ?? 255,
  }),
} as const satisfies ShaderModule<RescaleProps>;
```

- [ ] **Step 3: Update `buildCOGLayer` to select the right shader**

Inside `buildCOGLayer`, insert these three lines immediately before the `return new COGLayer<TileData>({` line:

```typescript
const rescaleModule =
  state.selected.dataType === "float32"
    ? RescaleFloat32
    : state.selected.dataType === "byte"
      ? RescaleByte
      : Rescale;
```

Then replace the hardcoded `module: Rescale` in the `renderPipeline` array with:

```typescript
module: rescaleModule,
```

- [ ] **Step 4: Run `pnpm check` and fix any errors**

```bash
pnpm check
```

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
feat(shaders): add float32 and byte rescale modules

Co-authored-by: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Band selector UI (`LayerPanel.tsx`)

**Files:**
- Modify: `src/components/LayerPanel.tsx`

**Interfaces:**
- Consumes: `state.bandCount: number`, `state.selectedBand: number`, `state.setBand: (b: number) => void` (from Task 1)

---

- [ ] **Step 1: Add band selector between source selector and Min control**

In `LayerPanel.tsx`, locate the closing `</div>` of the source selector block (the one that ends at approximately line 182, after the `</select>`). Insert the following JSX immediately after that `</div>`:

```tsx
{/* Band selector — shown for multi-band layers */}
{state.bandCount > 1 && (
  <div style={{ marginBottom: "12px" }}>
    <p style={{ margin: "0 0 6px 0", fontSize: "12px", color: "#666" }}>
      Band
    </p>
    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
      {Array.from({ length: state.bandCount }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => state.setBand(i)}
          style={{
            padding: "2px 8px",
            borderRadius: "4px",
            border: "1px solid #ccc",
            background: state.selectedBand === i ? "#333" : "transparent",
            color: state.selectedBand === i ? "#fff" : "#666",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          {i + 1}
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 2: Run `pnpm check` and fix any errors**

```bash
pnpm check
```

- [ ] **Step 3: Commit**

```bash
git add src/components/LayerPanel.tsx
git commit -m "$(cat <<'EOF'
feat(ui): add band selector for multi-band layers

Co-authored-by: Claude <noreply@anthropic.com>
EOF
)"
```

---

## End-to-end smoke test (after all three tasks)

With `npx serve --cors /Users/sludwig/Documents/Python/viz -l 8080` running and `.env.local` in place:

1. `pnpm dev` → open `http://localhost:3003/denali-fire-risk/` (port may vary)
2. Select **Above-ground combustion Historical** — tiles render in viridis, no change from before
3. Select **Fire risk** — band selector appears with buttons 1–12; tiles render in viridis with correct colors (no more wrong UInt16 decode)
4. Click band buttons — map updates to show the selected band
5. Click a pixel on the fire risk layer — popup shows a float value (0.02–0.74 range), not a large integer
6. Select **Land cover** — band selector shows buttons 1–2; tiles render in viridis stretched 0–25
7. Click a pixel on land cover — popup shows a class number (0–25)
8. Select any AGC/BGC layer — band selector disappears; rendering unchanged from Phase 1
