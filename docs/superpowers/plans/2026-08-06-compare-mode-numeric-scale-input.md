# Numeric Scale Input in Compare Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed `<input type="number">` alongside the Min/Max sliders in `LayerPanel`, visible only in compare mode, accepting display-unit values.

**Architecture:** All changes are isolated to `src/components/LayerPanel.tsx`. Two local draft states (`minDraft`, `maxDraft`) track in-progress typed values; they are committed to the shared layer state on blur or Enter. The `compareMode` prop already exists and gates the new UI.

**Tech Stack:** React 19, TypeScript, inline styles (no CSS files). No new dependencies.

## Global Constraints

- Only `src/components/LayerPanel.tsx` is modified — no other files touch.
- Feature is invisible in explore mode (`compareMode === false`).
- Display units in inputs; internal state stays in raw units (0–65535).
- `pnpm check` (Biome lint + format) must pass before every commit.
- Commit message format: `<type>(<scope>): <subject>` (Conventional Commits, ≤72 chars).

---

### Task 1: Add draft state and commit helpers to LayerPanel

**Files:**
- Modify: `src/components/LayerPanel.tsx:1-28`

**Interfaces:**
- Produces: `minDraft: string | null`, `maxDraft: string | null`, `commitMin(draft)`, `commitMax(draft)` — used in Task 2.

- [ ] **Step 1: Add React imports**

  Open `src/components/LayerPanel.tsx`. The file currently has no React imports (JSX transform handles JSX, but `useState`/`useEffect` must be imported explicitly). Add this as the first line:

  ```tsx
  import { useEffect, useState } from "react";
  ```

  The file's first two lines should now be:

  ```tsx
  import { useEffect, useState } from "react";
  import type { LayerState } from "../hooks/useLayerState.js";
  ```

- [ ] **Step 2: Add draft states and commit helpers inside the component**

  Inside `LayerPanel`, immediately after the `const isRight = side === "right";` line (currently line 29), add:

  ```tsx
  const [minDraft, setMinDraft] = useState<string | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);

  useEffect(() => {
    setMinDraft(null);
    setMaxDraft(null);
  }, [state.selectedIndex]);

  function commitMin(draft: string | null) {
    if (draft === null) return;
    const parsed = parseFloat(draft);
    if (Number.isNaN(parsed)) {
      setMinDraft(null);
      return;
    }
    const raw = Math.round(parsed / state.selected.displayScale);
    const clamped = Math.max(
      state.selected.dataMin,
      Math.min(state.selected.dataMax, raw),
    );
    state.setRangeMin(Math.min(clamped, state.rangeMax - 1));
    setMinDraft(null);
  }

  function commitMax(draft: string | null) {
    if (draft === null) return;
    const parsed = parseFloat(draft);
    if (Number.isNaN(parsed)) {
      setMaxDraft(null);
      return;
    }
    const raw = Math.round(parsed / state.selected.displayScale);
    const clamped = Math.max(
      state.selected.dataMin,
      Math.min(state.selected.dataMax, raw),
    );
    state.setRangeMax(Math.max(clamped, state.rangeMin + 1));
    setMaxDraft(null);
  }
  ```

- [ ] **Step 3: Run lint check**

  ```bash
  pnpm check
  ```

  Expected: no errors. If Biome reports formatting issues, run `pnpm check:fix` then re-run `pnpm check`.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/LayerPanel.tsx
  git commit -m "feat(ui): add draft state and commit helpers for numeric scale input"
  ```

---

### Task 2: Restructure Min and Max controls to show numeric inputs in compare mode

**Files:**
- Modify: `src/components/LayerPanel.tsx:139-191` (the Min and Max slider blocks)

**Interfaces:**
- Consumes: `minDraft`, `maxDraft`, `commitMin`, `commitMax` from Task 1; `compareMode` prop; `fmtVal` helper; `state.rangeMin`, `state.rangeMax`, `state.selected`, `state.setRangeMin`, `state.setRangeMax`.

- [ ] **Step 1: Replace the Min slider block**

  Find this block in `LayerPanel.tsx` (around line 140 after Task 1's additions):

  ```tsx
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
      Min: {fmtVal(state.rangeMin, state.selected)} {state.selected.units}
      <input
        type="range"
        min={state.selected.dataMin}
        max={state.selected.dataMax}
        step={1}
        value={state.rangeMin}
        onChange={(e) =>
          state.setRangeMin(
            Math.min(parseFloat(e.target.value), state.rangeMax - 1),
          )
        }
        style={{ width: "100%", cursor: "pointer" }}
      />
    </label>
  </div>
  ```

  Replace it with:

  ```tsx
  {/* Min control */}
  <div style={{ marginBottom: "8px" }}>
    {compareMode ? (
      <>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginBottom: "2px",
            fontSize: "12px",
            color: "#666",
          }}
        >
          <span>Min</span>
          <input
            type="number"
            value={minDraft ?? fmtVal(state.rangeMin, state.selected)}
            onChange={(e) => setMinDraft(e.target.value)}
            onBlur={() => commitMin(minDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitMin(minDraft);
            }}
            style={{
              width: "70px",
              fontSize: "12px",
              padding: "2px 4px",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          />
          <span>{state.selected.units}</span>
        </div>
        <input
          type="range"
          min={state.selected.dataMin}
          max={state.selected.dataMax}
          step={1}
          value={state.rangeMin}
          onChange={(e) =>
            state.setRangeMin(
              Math.min(parseFloat(e.target.value), state.rangeMax - 1),
            )
          }
          aria-label="Minimum value"
          style={{ width: "100%", cursor: "pointer" }}
        />
      </>
    ) : (
      <label
        style={{
          display: "block",
          fontSize: "12px",
          color: "#666",
          marginBottom: "2px",
        }}
      >
        Min: {fmtVal(state.rangeMin, state.selected)} {state.selected.units}
        <input
          type="range"
          min={state.selected.dataMin}
          max={state.selected.dataMax}
          step={1}
          value={state.rangeMin}
          onChange={(e) =>
            state.setRangeMin(
              Math.min(parseFloat(e.target.value), state.rangeMax - 1),
            )
          }
          style={{ width: "100%", cursor: "pointer" }}
        />
      </label>
    )}
  </div>
  ```

- [ ] **Step 2: Replace the Max slider block**

  Find this block (immediately after the Min block):

  ```tsx
  {/* Max slider */}
  <div style={{ marginBottom: "8px" }}>
    <label
      style={{
        display: "block",
        fontSize: "12px",
        color: "#666",
        marginBottom: "2px",
      }}
    >
      Max: {fmtVal(state.rangeMax, state.selected)} {state.selected.units}
      <input
        type="range"
        min={state.selected.dataMin}
        max={state.selected.dataMax}
        step={1}
        value={state.rangeMax}
        onChange={(e) =>
          state.setRangeMax(
            Math.max(parseFloat(e.target.value), state.rangeMin + 1),
          )
        }
        style={{ width: "100%", cursor: "pointer" }}
      />
    </label>
  </div>
  ```

  Replace it with:

  ```tsx
  {/* Max control */}
  <div style={{ marginBottom: "8px" }}>
    {compareMode ? (
      <>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginBottom: "2px",
            fontSize: "12px",
            color: "#666",
          }}
        >
          <span>Max</span>
          <input
            type="number"
            value={maxDraft ?? fmtVal(state.rangeMax, state.selected)}
            onChange={(e) => setMaxDraft(e.target.value)}
            onBlur={() => commitMax(maxDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitMax(maxDraft);
            }}
            style={{
              width: "70px",
              fontSize: "12px",
              padding: "2px 4px",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          />
          <span>{state.selected.units}</span>
        </div>
        <input
          type="range"
          min={state.selected.dataMin}
          max={state.selected.dataMax}
          step={1}
          value={state.rangeMax}
          onChange={(e) =>
            state.setRangeMax(
              Math.max(parseFloat(e.target.value), state.rangeMin + 1),
            )
          }
          aria-label="Maximum value"
          style={{ width: "100%", cursor: "pointer" }}
        />
      </>
    ) : (
      <label
        style={{
          display: "block",
          fontSize: "12px",
          color: "#666",
          marginBottom: "2px",
        }}
      >
        Max: {fmtVal(state.rangeMax, state.selected)} {state.selected.units}
        <input
          type="range"
          min={state.selected.dataMin}
          max={state.selected.dataMax}
          step={1}
          value={state.rangeMax}
          onChange={(e) =>
            state.setRangeMax(
              Math.max(parseFloat(e.target.value), state.rangeMin + 1),
            )
          }
          style={{ width: "100%", cursor: "pointer" }}
        />
      </label>
    )}
  </div>
  ```

- [ ] **Step 3: Run lint check**

  ```bash
  pnpm check
  ```

  Expected: no errors. Run `pnpm check:fix` if Biome reports formatting issues, then re-run.

- [ ] **Step 4: Build**

  ```bash
  pnpm build
  ```

  Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Verify in dev server**

  ```bash
  pnpm dev
  ```

  Open http://localhost:3000. Manual checks:

  1. **Explore mode (default):** Open the left panel. Min and Max controls look exactly as before — static label text + slider wrapped in a `<label>`. No number input visible.
  2. **Switch to compare mode:** Click the Compare button. Open the left panel. The Min and Max rows now show `Min [input] g-C/m²` above the slider.
  3. **Slider sync:** Drag the Min slider — the number input updates to match.
  4. **Type a valid value:** Click the number input, type a new value within range (e.g., `200`), press Enter or click away — the slider jumps to the corresponding position and the rendered raster updates.
  5. **Type an out-of-range value:** Type a value above `dataMax` (e.g., `99999`), press Enter — input clamps to the max, no crash.
  6. **Type garbage:** Type `abc`, press Enter — input resets to the last valid value, no crash.
  7. **Min ≥ Max guard:** Set Min to a value higher than Max — the input should clamp to `rangeMax - 1`.
  8. **Source switch clears draft:** While a value is mid-edit, change the source selector — the draft clears and the input shows the new source's default value.
  9. **Right panel in compare mode:** Open the right panel — same numeric input behaviour.
  10. **Match scale button:** Still present and functional in the right panel.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/LayerPanel.tsx
  git commit -m "feat(ui): add numeric scale inputs alongside sliders in compare mode"
  ```
