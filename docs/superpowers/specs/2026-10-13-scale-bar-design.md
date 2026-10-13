# Scale Bar — Design Spec

**Date:** 2026-10-13  
**App:** boreal-web-viewer

---

## Goal

Add a dynamic distance scale bar to the map viewer that updates in real time as the user zooms or pans, and is displayed in the bottom-left corner of the viewport.

---

## Requirements

- Show a horizontal distance scale bar with a km label (e.g., "200 km")
- Update whenever `zoom` or `latitude` changes
- Position: bottom-left corner of the viewport, clear of map controls
- Legible on both the dark and satellite basemaps
- Does not block map interaction (`pointerEvents: none`)
- Units: km only (metric; the audience is climate scientists)

---

## Out of Scope

- Dual units (km/miles)
- Click-to-toggle units
- Per-panel scale bars in compare mode (both maps share the same `viewState`, so one bar is correct for both)

---

## Architecture

### New file: `src/components/ScaleBar.tsx`

A pure presentational component. All inputs come as props; no internal state, no map API calls.

```ts
interface ScaleBarProps {
  zoom: number;
  latitude: number;
}
```

**Math — meters per pixel (Web Mercator):**

```
metersPerPixel = cos(lat × π/180) × 2πR / (256 × 2^zoom)
```

R = 6 378 137 m (WGS-84 equatorial radius). This formula is exact for Web Mercator at the given latitude.

**Scale selection:**

1. Target bar width: ~120 px
2. Compute `targetKm = metersPerPixel × 120 / 1000`
3. Walk the ladder `[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]` km
4. Take the largest value ≤ `targetKm` (or fall back to 1 km if `targetKm < 1`)
5. Actual bar pixel width = `niceKm × 1000 / metersPerPixel`

This keeps the bar in the ~60–120 px range and ensures labels jump to clean round numbers.

**Rendering — cartographic ruler style:**

```
200 km
└──────────────────┘
```

- Label: centered above the bar, white text, `textShadow: "1px 1px 2px rgba(0,0,0,0.8)"` for legibility on both basemaps
- Bar: a single `div` using the CSS border trick — `borderLeft`, `borderRight`, `borderBottom` (2 px white each) form the ⌐¬ shape with end ticks
- No background box — keeps the element visually lightweight and avoids competing with the LayerPanel
- `pointerEvents: none`
- Positioned `bottom: 20px, left: 20px`, `zIndex: 1000`
- Font: same as the rest of the app (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`), `fontSize: 11px`

---

## Integration — `src/App.tsx`

Two changes only:

1. **Import** (with other component imports near top of file):
   ```ts
   import { ScaleBar } from "./components/ScaleBar.js";
   ```

2. **JSX** (last overlay before the closing root `</div>`):
   ```jsx
   <ScaleBar zoom={viewState.zoom} latitude={viewState.latitude} />
   ```

`viewState` already updates on every `onMove` event, so no new state or hooks are required.

---

## Files Touched

| File | Change |
|------|--------|
| `src/components/ScaleBar.tsx` | New — ~40 lines |
| `src/App.tsx` | +1 import, +1 JSX element |

---

## Verification

No test framework is configured in this repo. Verification is manual:

1. `pnpm dev`
2. Zoom in and out across the boreal extent (~55°–70°N) — confirm bar width updates and label jumps to clean round values
3. Pan to equatorial and polar latitudes — confirm bar reflects latitude-dependent scale correctly
4. Toggle to satellite basemap — confirm label remains legible
5. Switch to compare mode — confirm one scale bar is sufficient and doesn't overlap controls
6. `pnpm check` — Biome lint/format must pass before committing
