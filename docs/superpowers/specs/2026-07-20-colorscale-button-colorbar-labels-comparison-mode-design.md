# Design: Auto-scale Button, Colorbar Labels, and Comparison Mode

**Date:** 2026-07-20
**Branch:** split_view
**Status:** Approved

## Overview

Three related UI improvements to `boreal-web-viewer`:

1. **Auto-scale button** — replace the current behavior (color scale resets on every viewport change) with an explicit button, while still auto-scaling on layer switch.
2. **Colorbar min/max labels** — display the current rescale min and max values as text at the ends of the colorbar strip.
3. **Comparison mode** — a draggable swipe split-view with independent left/right source selectors, per-panel controls, and a "Match scale" button when units match.

---

## Architecture

### New files

| File | Purpose |
|------|---------|
| `src/hooks/useLayerState.ts` | All per-panel state and callbacks |
| `src/components/LayerPanel.tsx` | Panel UI: source selector, sliders, auto-scale button, colorbar, match-scale button |

### Modified files

| File | Changes |
|------|---------|
| `src/App.tsx` | Mode toggle, two-map layout in compare mode, shared `viewState`, `basemap`, `hasInitialFitRef`, divider state |

### State ownership

**`App.tsx` owns (global):**
- `mode: 'explore' | 'compare'`
- `basemap: BasemapKey` (shared between both maps)
- `viewState` (controlled, synced across both maps in compare mode)
- `hasInitialFitRef` (only left panel triggers initial `fitBounds`)
- `dividerX: number` + drag state (compare mode only)

**`useLayerState` owns (per panel):**
- `selectedIndex`, `selected` (derived `SOURCES[selectedIndex]`)
- `rangeMin`, `rangeMax`
- `dataOpacity`
- `panelOpen` (collapse state for the panel)
- `device`, `deviceError`, `colormapTexture`
- `metadataLoaded`, `tilesLoading`, `loadingCountRef`, `hideTimerRef`
- `geotiffRef`
- `clickInfo`
- `pendingAutoScale: { min: number; max: number } | null`
- `shouldAutoScaleRef: MutableRefObject<boolean>`

`App` always instantiates both `leftState = useLayerState()` and `rightState = useLayerState()` (hooks must be unconditional). `rightState` is only rendered and wired up in compare mode.

The full-screen device error UI checks only `leftState.deviceError` — if the GPU fails it fails for both.

---

## Feature 1: Auto-scale button

### Behavior

| Trigger | Action |
|---------|--------|
| Viewport pan/zoom (tile load) | Compute histogram → store in `pendingAutoScale`; do **not** apply to scale |
| Layer switch | Compute histogram on next viewport load → **auto-apply once**, then stop |
| "Auto-scale" button click | Apply `pendingAutoScale` to `rangeMin`/`rangeMax` |

### Implementation in `useLayerState`

Extract the histogram computation from the current `onViewportLoad` inline block into a standalone pure function at module scope:

```ts
function computeAutoScale(tiles: Tile[]): { min: number; max: number } | null
```

It runs the same 2%/98% percentile logic over `rawData` from loaded tiles and returns `null` if no valid pixels are found.

Inside the hook:

```ts
const [pendingAutoScale, setPendingAutoScale] =
  useState<{ min: number; max: number } | null>(null);
const shouldAutoScaleRef = useRef(true); // true = apply on next load

// On layer switch
useEffect(() => {
  setRangeMin(selected.dataMin);
  setRangeMax(selected.dataMax);
  shouldAutoScaleRef.current = true;
  setPendingAutoScale(null);
}, [selectedIndex]);

// Called as onViewportLoad on the COGLayer
const handleViewportLoad = useCallback((tiles) => {
  const computed = computeAutoScale(tiles);
  if (!computed) return;
  setPendingAutoScale(computed);
  if (shouldAutoScaleRef.current) {
    setRangeMin(computed.min);
    setRangeMax(computed.max);
    shouldAutoScaleRef.current = false;
  }
}, []);

// Exposed for button onClick
const applyAutoScale = useCallback(() => {
  if (pendingAutoScale) {
    setRangeMin(pendingAutoScale.min);
    setRangeMax(pendingAutoScale.max);
  }
}, [pendingAutoScale]);
```

### UI in `LayerPanel`

Button placed below the max slider, above the basemap toggle:

```
Min: 142 g-C/m²  [slider]
Max: 3102 g-C/m² [slider]
[Auto-scale]              ← disabled when pendingAutoScale is null
[Switch to satellite basemap]
```

Button is disabled (with `disabled` attribute) when `state.pendingAutoScale` is null — i.e., before the first viewport load after a layer switch. No loading state needed; the sliders update immediately when clicked.

---

## Feature 2: Colorbar min/max labels

### Current layout

```
[viridis gradient bar — 12px tall]
        g-C/m²              ← centered <p>
```

### New layout

```
[viridis gradient bar — 12px tall]
142          g-C/m²          3102    ← flex row, space-between
```

Implemented as a `display: flex; justify-content: space-between` row directly below the bar. The three spans are:

- Left: `fmtVal(rangeMin, selected)` 
- Center: `selected.units`
- Right: `fmtVal(rangeMax, selected)`

All three update live as sliders move or auto-scale fires (they read directly from `state.rangeMin` / `state.rangeMax`).

---

## Feature 3: Comparison mode

### Mode toggle

A two-button pill control, `position: absolute; top: 20px; left: 50%; transform: translateX(-50%)`, always visible above both maps:

```
[ Exploration ]  [ Comparison ]
```

Active mode button has a visually distinct background. The control sits above the map panels at `zIndex: 1000`.

### Map layout

Both `MaplibreMap` instances are absolutely positioned to fill the viewport. The right map's **wrapper `<div>`** has `clipPath: inset(0 0 0 ${dividerX}px)` so only the portion right of the divider is visible. The left map renders underneath, unclipped.

```
position: absolute, full screen
┌─────────────────────────────────┐
│         Left MaplibreMap        │  ← always fully rendered
└─────────────────────────────────┘
         ┌───────────────────────┐
         │    Right MaplibreMap  │  ← clipped left at dividerX
         └───────────────────────┘
              ↑ dividerX
```

### View state synchronization

Both maps use controlled `viewState` held in `App`. Either map's `onMove` handler updates the shared state:

```ts
const [viewState, setViewState] = useState({ longitude: -112.5, latitude: 60, zoom: 3, pitch: 0, bearing: 0 });

// on both maps:
onMove={(e) => setViewState(e.viewState)}
```

In explore mode the left map alone uses controlled `viewState` (same pattern, just one map).

### Draggable divider

A `<div>` absolutely positioned at `left: dividerX`, full height, 2px wide with a centered circular drag handle. Drag implementation:

- `onMouseDown` on the handle sets `isDraggingRef.current = true`
- `document` `mousemove` handler (added on drag start, removed on drag end) updates `dividerX` clamped to `[50, window.innerWidth - 50]`
- `mouseup` clears the dragging ref
- Same pattern for `touchstart`/`touchmove`/`touchend` for mobile

`dividerX` initialises to `window.innerWidth / 2`.

### Panel layout in compare mode

- Left `LayerPanel`: `position: absolute; top: 20px; left: 20px`
- Right `LayerPanel`: `position: absolute; top: 20px; right: 20px`

Each panel has its own collapse toggle (the existing `panelOpen` pattern, one per `useLayerState`).

### Loading spinners in compare mode

- Left spinner: `left: 25%; transform: translateX(-50%)`
- Right spinner: `left: 75%; transform: translateX(-50%)`

### Click-to-query / Popup

Each map has its own `handleMapClick` (from its `useLayerState`) and renders its own `<Popup>` inside its `<MaplibreMap>`. No cross-panel interaction.

### Initial bounds fit

Only `leftState`'s `onGeoTIFFLoad` callback calls `mapRef.current?.fitBounds(...)`. `hasInitialFitRef` stays in `App` and is checked inside that callback. Since `viewState` is shared, the right map follows automatically.

### Match scale button

Rendered at the bottom of the **right** `LayerPanel` only (in compare mode):

```
[← Match scale]
```

- **Enabled** when `leftState.selected.units === rightState.selected.units`
- **Disabled** when units differ, with `title="Sources must have the same units to match scale"` for context
- On click:
  ```ts
  rightState.setRangeMin(leftState.rangeMin);
  rightState.setRangeMax(leftState.rangeMax);
  ```

`App` passes `onMatchScale` and `matchScaleEnabled` as props to the right `LayerPanel`.

---

## `LayerPanel` component props

```ts
type LayerPanelProps = {
  state: LayerState;           // return value of useLayerState
  compareMode?: boolean;       // show match-scale button area
  onMatchScale?: () => void;   // right panel only
  matchScaleEnabled?: boolean; // right panel only
};
```

`mapRef` is not a `LayerPanel` concern — it is held in `App` and used only inside the `onGeoTIFFLoad` callback when constructing the left `COGLayer`.

---

## Out of scope

- Colormap selection (not requested)
- Syncing basemap independently per panel (basemap stays global)
- Right panel triggering initial `fitBounds` (left panel only)
- Mobile layout of side-by-side panels (panels collapse to icons on small screens as they do today)