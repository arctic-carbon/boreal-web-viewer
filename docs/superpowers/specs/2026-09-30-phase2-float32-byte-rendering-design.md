# Phase 2: Float32 and Byte Render Pipeline Design

**Date:** 2026-09-30
**Branch:** denali-data
**Scope:** Local development — fixes incorrect rendering of `fire_risk` (Float32, 12-band) and `landcover` (Byte, 2-band) layers

## Goal

Make Float32 and Byte layers render correctly by threading `dataType` and
`selectedBand` through the tile-loading pipeline, adding two shader modules,
and exposing a band selector in the UI.

## Non-goals

- Categorical colormap for landcover (viridis is used as-is)
- Auto-scale for Float32 or Byte layers (disabled — fixed range from `sources.ts`)
- Band labels / metadata beyond band number
- Production deployment

## Layers affected

| Layer | File | dataType | Bands | Nodata |
|---|---|---|---|---|
| Fire risk | `fire_risk_denali.tif` | `float32` | 12 | NaN |
| Land cover | `landcover_denali.tif` | `byte` | 2 | 0 |

UInt16 layers (AGC, BGC) are unchanged.

## Architecture

Three localized changes, each independently testable:

1. **`useLayerState.ts`** — type-aware tile loader + band state
2. **`App.tsx`** — two new shader modules + shader selector
3. **`LayerPanel.tsx`** — band selector UI

---

## Section 1: `useLayerState.ts`

### `padRows` — generalized for any element size

Current implementation hard-codes `rowBytes = width * 2` (UInt16). Replace
with a `bytesPerElement` parameter:

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
  // Return same type as input
  if (data instanceof Float32Array) return new Float32Array(dst.buffer);
  if (data instanceof Uint8Array) return new Uint8Array(dst.buffer);
  return new Uint16Array(dst.buffer);
}
```

### `TileData` — widened `rawData` type

```typescript
export type TileData = {
  height: number;
  width: number;
  texture: Texture;
  rawData: Uint16Array | Float32Array | Uint8Array;
};
```

### `getTileData` — gains `dataType` and `band`

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

  // Pick the right band array
  const raw =
    "data" in tile.array ? tile.array.data : (tile.array.bands[band] ?? tile.array.bands[0]!);

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

  // uint16 — existing path
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

### `computeAutoScale` — skips non-uint16

Add an early return at the top of the function:

```typescript
function computeAutoScale(tiles: LoadedTile[]): { min: number; max: number } | null {
  // Auto-scale only implemented for uint16 layers
  const first = (tiles[0]?.data as TileData | null | undefined)?.rawData;
  if (!first || !(first instanceof Uint16Array)) return null;
  // ... rest of existing implementation unchanged
}
```

### `trackingGetTileData` — closure capturing `dataType` and `selectedBand`

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
  [selected.dataType, selectedBand],
);
```

### `handleMapClick` — nodata check branches on `dataType`

```typescript
const isNodata = selected.dataType === "float32"
  ? Number.isNaN(value)
  : value === 0;
if (isNodata) {
  setClickInfo(null);
} else {
  setClickInfo({ lng: e.lngLat.lng, lat: e.lngLat.lat, value });
}
```

### New state: `selectedBand` and `bandCount`

```typescript
const [selectedBand, setSelectedBand] = useState(0);
const [bandCount, setBandCount] = useState(1);
```

`selectedBand` and `bandCount` reset when `selectedIndex` changes (add to the
existing `useEffect` that resets `rangeMin`/`rangeMax`):

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

`handleGeoTIFFLoad` sets `bandCount` from the GeoTIFF object:

```typescript
const handleGeoTIFFLoad = useCallback(
  (tiff: GeoTIFF, options: { ... }) => {
    setMetadataLoaded(true);
    setBandCount(tiff.count ?? 1);
    // ... existing proj4 setup unchanged
  },
  [],
);
```

`LayerState` interface gains:

```typescript
selectedBand: number;
setBand: (b: number) => void;
bandCount: number;
```

---

## Section 2: `App.tsx`

### `RescaleFloat32` shader module

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

### `RescaleByte` shader module

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

### `buildCOGLayer` — shader selector

Add before the `return new COGLayer(...)` call:

```typescript
const rescaleModule =
  state.selected.dataType === "float32" ? RescaleFloat32
  : state.selected.dataType === "byte" ? RescaleByte
  : Rescale;
```

Replace the hardcoded `module: Rescale` in the `renderPipeline` with
`module: rescaleModule`.

---

## Section 3: `LayerPanel.tsx`

When `state.bandCount > 1`, render a band selector between the layer dropdown
and the range slider. Buttons are numbered 1–N (1-indexed display, 0-indexed
internally). Active band is highlighted; others muted. No label text beyond
the number.

```tsx
{state.bandCount > 1 && (
  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
    {Array.from({ length: state.bandCount }, (_, i) => (
      <button
        key={i}
        type="button"
        onClick={() => state.setBand(i)}
        style={{
          padding: "2px 8px",
          borderRadius: 4,
          border: "1px solid #555",
          background: state.selectedBand === i ? "#fff" : "transparent",
          color: state.selectedBand === i ? "#000" : "#aaa",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        {i + 1}
      </button>
    ))}
  </div>
)}
```

---

## Confirmed implementation details

- Band count: `tiff.count` — a getter on `@developmentseed/geotiff`'s `GeoTIFF` type
- Texture formats `r8unorm`, `r16unorm`, `r32float` all confirmed valid in luma.gl 9.3.x
