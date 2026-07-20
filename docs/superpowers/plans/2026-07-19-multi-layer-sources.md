# Multi-Layer Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose all 8 .tif layers from the boreal-fire-carbon repository in a dropdown, with min/max sliders, units label, and click popup all automatically updating to each layer's correct range and units on selection.

**Architecture:** A new `src/sources.ts` module holds the full layer config (URL, data range, units, display scale). `App.tsx` imports it, replacing the hardcoded `COG_OPTIONS`, `DATA_MIN`, and `DATA_MAX` constants. A `useEffect` on `selectedIndex` resets slider state to the new layer's bounds.

**Tech Stack:** React 19, TypeScript, Vite 7, Biome (lint/format), pnpm 10

## Global Constraints

- No new npm dependencies.
- Run `pnpm check` before every commit; fix all errors before proceeding.
- Commit message format: `<type>(<scope>): <subject>` (Conventional Commits), subject ≤ 72 chars, imperative mood.
- Include `Co-authored-by: Claude <noreply@anthropic.com>` trailer on every commit.
- Zero is nodata — already discarded by the Rescale shader (`if (rawValue == 0.0) discard`); do not change this.
- `cache: "no-store"` on `SourceHttp.fetch` is intentional — do not remove it.
- Depth layers store values as integers (cm × 100). `displayScale: 0.01` converts to cm for display only; the shader always receives raw pixel values.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/sources.ts` | **Create** | `LayerSource` type + `SOURCES` array with all 8 layers |
| `src/App.tsx` | **Modify** | Replace hardcoded config with `SOURCES`; auto-reset state on layer change; display scaled values with units |

---

### Task 1: Create `src/sources.ts`

**Files:**
- Create: `src/sources.ts`

**Interfaces:**
- Produces: `LayerSource` type and `SOURCES: LayerSource[]` — consumed by Task 2

- [ ] **Step 1: Create `src/sources.ts` with the full layer config**

```typescript
const BASE =
  "https://data.source.coop/luddaludwig/boreal-fire-carbon";

export type LayerSource = {
  id: string;
  url: string;
  title: string;
  dataMin: number;
  dataMax: number;
  units: string;
  displayScale: number;
};

export const SOURCES: LayerSource[] = [
  {
    id: "AGC_ssp585",
    url: `${BASE}/AGC_ssp585.tif`,
    title: "Above-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 95,
    dataMax: 3295,
  },
  {
    id: "AGC_ssp126",
    url: `${BASE}/AGC_ssp126.tif`,
    title: "Above-ground combustion SSP-126",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 85,
    dataMax: 3297,
  },
  {
    id: "AGC_historical",
    url: `${BASE}/AGC_historical.tif`,
    title: "Above-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 72,
    dataMax: 3281,
  },
  {
    id: "BGC_ssp585",
    url: `${BASE}/BGC_ssp585.tif`,
    title: "Below-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1079,
    dataMax: 5645,
  },
  {
    id: "BGC_ssp126",
    url: `${BASE}/BGC_ssp126.tif`,
    title: "Below-ground combustion SSP-126",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1099,
    dataMax: 5539,
  },
  {
    id: "BGC_historical",
    url: `${BASE}/BGC_historical.tif`,
    title: "Below-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 985,
    dataMax: 5762,
  },
  {
    id: "Depth_ssp585",
    url: `${BASE}/Depth_ssp585.tif`,
    title: "Burn depth SSP-585",
    units: "cm",
    displayScale: 0.01,
    dataMin: 467,
    dataMax: 2111,
  },
  {
    id: "Depth_ssp126",
    url: `${BASE}/Depth_ssp126.tif`,
    title: "Burn depth SSP-126",
    units: "cm",
    displayScale: 0.01,
    dataMin: 491,
    dataMax: 2166,
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

Run: `pnpm check`
Expected: `Checked N files in Xms. No fixes applied.`

- [ ] **Step 3: Commit**

```bash
git add src/sources.ts
git commit -m "$(cat <<'EOF'
feat(sources): add sources.ts config module with all 8 layers

Co-authored-by: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Wire `SOURCES` into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `LayerSource`, `SOURCES` from `./sources.ts`

- [ ] **Step 1: Replace the `COG_OPTIONS`, `DATA_MIN`, `DATA_MAX` block**

Find and remove this block in `App.tsx` (lines ~55–86 after the cache comment):

```typescript
const COG_OPTIONS: { title: string; url: string }[] = [
  {
    title: "Above-ground combustion SSP-585",
    url: "https://data.source.coop/luddaludwig/boreal-fire-carbon/AGC_ssp585.tif",
  },
  {
    title: "Below-ground combustion SSP-585",
    url: "https://data.source.coop/luddaludwig/boreal-fire-carbon/BGC_ssp585.tif",
  },
];

// const COG_URL =
//   "https://data.source.coop/luddaludwig/boreal-fire-carbon/AGC_ssp585.tif";
```

And this block (the hardcoded data range comment + constants):

```typescript
// ---- Data range (from gdalinfo: Min=90, Max=3290 for the unsigned version) ----
// The Int16 source has the same value range; negative values are nodata/unused.
const DATA_MIN = 90;
const DATA_MAX = 3290;
```

Also remove the dead `cogPromise` comment:
```typescript
// const cogPromise = GeoTIFF.fromUrl(COG_URL);
```

- [ ] **Step 2: Add the `SOURCES` import at the top of `App.tsx`**

After the existing imports, add (Biome will re-order it correctly on save):

```typescript
import { type LayerSource, SOURCES } from "./sources.js";
```

- [ ] **Step 3: Update the `selected` variable inside `App()` to use `SOURCES`**

Find (inside `App()`, just after the state hooks):
```typescript
  const selected = COG_OPTIONS[selectedIndex];
```

Replace with:
```typescript
  const selected = SOURCES[selectedIndex];
```

- [ ] **Step 4: Update `Rescale.getUniforms` to remove the `DATA_MIN`/`DATA_MAX` fallback references**

Find:
```typescript
  getUniforms: (props: Partial<RescaleProps>) => ({
    rangeMin: props.rangeMin ?? DATA_MIN,
    rangeMax: props.rangeMax ?? DATA_MAX,
  }),
```

Replace with:
```typescript
  getUniforms: (props: Partial<RescaleProps>) => ({
    rangeMin: props.rangeMin ?? 0,
    rangeMax: props.rangeMax ?? 65535,
  }),
```

- [ ] **Step 5: Add the `fmtVal` display helper before the `App()` function**

Add this function just above `export default function App()`:

```typescript
function fmtVal(raw: number, src: LayerSource): string {
  return (raw * src.displayScale).toFixed(src.displayScale < 1 ? 2 : 0);
}
```

- [ ] **Step 6: Seed initial `rangeMin`/`rangeMax` state from `SOURCES[0]`**

Find:
```typescript
  const [rangeMin, setRangeMin] = useState(DATA_MIN);
  const [rangeMax, setRangeMax] = useState(DATA_MAX);
```

Replace with:
```typescript
  const [rangeMin, setRangeMin] = useState(SOURCES[0].dataMin);
  const [rangeMax, setRangeMax] = useState(SOURCES[0].dataMax);
```

- [ ] **Step 7: Add `useEffect` to reset state on layer change**

After the existing `useEffect` that injects the `@keyframes spin` CSS (around line 267), add:

```typescript
  useEffect(() => {
    const src = SOURCES[selectedIndex];
    setRangeMin(src.dataMin);
    setRangeMax(src.dataMax);
    setMetadataLoaded(false);
    setClickInfo(null);
  }, [selectedIndex]);
```

- [ ] **Step 8: Update the dropdown to use `SOURCES`**

Find:
```typescript
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
            >
              {COG_OPTIONS.map((opt, i) => (
                <option key={opt.url} value={i}>
                  {opt.title}
                </option>
              ))}
              </select>
```

Replace with:
```typescript
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
            >
              {SOURCES.map((src, i) => (
                <option key={src.id} value={i}>
                  {src.title}
                </option>
              ))}
            </select>
```

- [ ] **Step 9: Update slider `min`/`max` bounds and labels**

Find the Min slider label and input:
```typescript
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
```

Replace with:
```typescript
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "2px",
              }}
            >
              Min: {fmtVal(rangeMin, selected)} {selected.units}
              <input
                type="range"
                min={selected.dataMin}
                max={selected.dataMax}
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
```

Find the Max slider label and input:
```typescript
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
```

Replace with:
```typescript
            <label
              style={{
                display: "block",
                fontSize: "12px",
                color: "#666",
                marginBottom: "2px",
              }}
            >
              Max: {fmtVal(rangeMax, selected)} {selected.units}
              <input
                type="range"
                min={selected.dataMin}
                max={selected.dataMax}
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
```

- [ ] **Step 10: Update the units label under the colormap gradient**

Find:
```typescript
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
```

Replace with:
```typescript
          <p
            style={{
              margin: "0 0 12px 0",
              fontSize: "11px",
              color: "#999",
              textAlign: "center",
            }}
          >
            {selected.units}
          </p>
```

- [ ] **Step 11: Update the click popup to show scaled value with units**

Find:
```typescript
              <div>
                <span style={{ opacity: 0.6 }}>Value</span>{" "}
                <strong>{clickInfo.value}</strong>
              </div>
```

Replace with:
```typescript
              <div>
                <span style={{ opacity: 0.6 }}>Value</span>{" "}
                <strong>
                  {fmtVal(clickInfo.value, selected)} {selected.units}
                </strong>
              </div>
```

- [ ] **Step 12: Verify no TypeScript or lint errors**

Run: `pnpm check`
Expected: `Checked N files in Xms. No fixes applied.`

If Biome reports an import order issue, run `pnpm check:fix` to auto-sort, then re-run `pnpm check` to confirm clean.

- [ ] **Step 13: Start the dev server and manually verify**

Run: `pnpm dev`

Check all of the following:

1. **Dropdown shows all 8 layers** — open the panel and count: 3 AGC, 3 BGC, 2 Depth.
2. **Sliders reset on switch** — select "Burn depth SSP-585"; Min slider should jump to ~4.67 cm, Max to ~21.11 cm. Select an AGC layer; Min should jump to ~95 g-C/m², Max to ~3295 g-C/m².
3. **Units label updates** — colormap legend reads "cm" for Depth layers, "g-C/m²" for AGC/BGC.
4. **Loading spinner** — switching layers should briefly show "Loading metadata…" again.
5. **Click popup** — click on data in a Depth layer; popup should show e.g. `Value 8.43 cm`. Click on an AGC layer; popup should show e.g. `Value 1204 g-C/m²`.
6. **Click popup clears** — old popup from the previous layer disappears immediately on layer switch.
7. **Map fits to new layer** — map re-fits bounds when switching layers.

- [ ] **Step 14: Commit**

```bash
git add src/App.tsx
git commit -m "$(cat <<'EOF'
feat(sources): wire SOURCES config into App, auto-reset scale on layer change

Replace COG_OPTIONS/DATA_MIN/DATA_MAX with SOURCES from sources.ts.
Add fmtVal helper; slider bounds, labels, units, and popup now reflect
each layer's data range and units automatically.

Co-authored-by: Claude <noreply@anthropic.com>
EOF
)"
```