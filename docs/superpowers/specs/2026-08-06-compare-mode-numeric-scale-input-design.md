# Design: Numeric Scale Input in Compare Mode

**Date:** 2026-08-06
**Status:** Approved

## Overview

Add a typed numeric input alongside the Min and Max sliders in the LayerPanel, visible only when compare mode is active. This lets users set precise scale bounds by typing display-unit values instead of relying solely on the slider. Had to resend due to webhook error in Github actions.

## Scope

- **File changed:** `src/components/LayerPanel.tsx` only.
- No changes to `useLayerState.ts`, `App.tsx`, or `sources.ts`.
- The feature is gated behind the existing `compareMode` prop — invisible in explore mode.

## Layout

In compare mode, each of the Min and Max controls is restructured from a single wrapped label into two rows:

**Before (explore mode, unchanged):**
```
Min: 95 g-C/m²
[================slider================]
```

**After (compare mode only):**
```
Min              [  95  ]  g-C/m²
[================slider================]
```

The header row is a flex container:
- Left: static label text ("Min" or "Max")
- Center: `<input type="number">` showing the current display value
- Right: units string (e.g., `g-C/m²`)

The slider sits below, full width, unchanged from today. In explore mode the layout is identical to today.

## State Management

Two local draft states are added inside `LayerPanel`:

```ts
const [minDraft, setMinDraft] = useState<string | null>(null);
const [maxDraft, setMaxDraft] = useState<string | null>(null);
```

**Display value shown in the input:**
- When draft is `null`: `fmtVal(state.rangeMin, state.selected)` (the same formatted value shown today).
- When draft is non-null: the draft string as-is (what the user is typing).

**On change** (`onChange`): update the draft string only — no conversion, no clamping.

**On commit** (`onBlur` or Enter `onKeyDown`):
1. Parse the draft with `parseFloat`.
2. If NaN or empty: clear draft, leave the underlying value unchanged.
3. Convert to raw: `Math.round(parsed / selected.displayScale)`.
4. Clamp to `[selected.dataMin, selected.dataMax]`.
5. Enforce `min < max`: same guard the slider already applies.
6. Call `setRangeMin` or `setRangeMax` with the clamped raw value.
7. Clear the draft (`null`).

**Slider sync:** When the slider is dragged, `state.rangeMin` / `state.rangeMax` update. Because the draft is `null` at that point, the number input re-renders with the freshly formatted display value — they stay in sync automatically.

**Source change:** A `useEffect` inside `LayerPanel` watches `state.selectedIndex` and resets both drafts to `null` when it changes, preventing a stale typed value from persisting across a source switch.

## Conversion Reference

| Direction | Formula |
|-----------|---------|
| Raw → display | `(raw * displayScale).toFixed(displayScale < 1 ? 2 : 0)` (existing `fmtVal`) |
| Display → raw | `Math.round(displayValue / displayScale)` |

## Error Handling

- Non-numeric input: silently reset to last valid value on blur/Enter.
- Out-of-range: clamp silently (same behavior as dragging slider to its limit).
- Min ≥ Max: enforce `min ≤ max - 1` raw unit (same guard as slider `onChange`).

## What Is Not Changing

- Explore mode layout — identical to today.
- The `useLayerState` hook — no new state or exports.
- The `matchScale` button in the right panel — unaffected.
- The opacity slider — unaffected (no numeric input added there).
