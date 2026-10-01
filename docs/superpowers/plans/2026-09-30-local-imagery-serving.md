# Local Imagery Serving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap all data sources from source.coop URLs to locally-hosted COG files served from `http://localhost:8080`, toggled via a `.env.local` env var with automatic fallback to source.coop when absent.

**Architecture:** A `VITE_DATA_BASE_URL` environment variable in `.env.local` (gitignored) overrides the base URL in `sources.ts`. A separate `npx serve --cors` process serves the local COG files on port 8080. The `SOURCES` array is replaced with six Denali-specific layers; a new `dataType` field on `LayerSource` prepares for Phase 2 Float32/Byte shader support without yet consuming it.

**Tech Stack:** Vite 7, TypeScript strict mode, Biome for lint+format, pnpm 10. No unit test framework — verification is `pnpm check` (TypeScript + Biome) plus manual browser confirmation.

## Global Constraints

- Run `pnpm check` before every commit — Biome lint + format errors are blocking
- No new dependencies
- Do not modify `App.tsx`, `useLayerState.ts`, or `LayerPanel.tsx`
- `.env.local` is never committed (already in Vite's default `.gitignore`)
- Commit messages follow Conventional Commits: `<type>(<scope>): <description>` ≤ 72 chars, imperative mood, trailer `Co-authored-by: Claude <noreply@anthropic.com>`
- Local COG files must already be converted to COG format and reprojected to WGS84 (EPSG:4326) before manual verification will work — this is a prerequisite outside this plan

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/vite-env.d.ts` | Create | Declare `VITE_DATA_BASE_URL` on `ImportMetaEnv` |
| `src/sources.ts` | Modify | Env-var BASE URL, `dataType` field, Denali SOURCES array |
| `CLAUDE.md` | Modify | Document local dev server setup |

---

## Task 1: Add env type declaration and update sources

**Files:**
- Create: `src/vite-env.d.ts`
- Modify: `src/sources.ts`

**Interfaces:**
- Produces: `LayerSource` type with new required `dataType: "uint16" | "float32" | "byte"` field; `SOURCES` array of six Denali layers; `BASE` URL that reads from `import.meta.env.VITE_DATA_BASE_URL`

---

- [ ] **Step 1: Create `src/vite-env.d.ts`**

Create the file with this exact content — it extends Vite's built-in `ImportMetaEnv` to add the custom variable:

```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: Replace `src/sources.ts` entirely**

The new file uses `??` to fall back to source.coop when the env var is absent. The `dataType` field is added to `LayerSource` and populated on every entry. Data ranges for UInt16 layers are derived from `gdalinfo -mm` on the Denali files; the `dataMin` of 1 excludes the nodata value of 0 (the render pipeline discards pixels where `rawValue == 0`).

```typescript
const BASE = import.meta.env.VITE_DATA_BASE_URL
  ?? "https://data.source.coop/luddaludwig/boreal-fire-carbon";

export type LayerSource = {
  id: string;
  url: string;
  title: string;
  dataMin: number;
  dataMax: number;
  units: string;
  displayScale: number;
  dataType: "uint16" | "float32" | "byte";
};

export const SOURCES: LayerSource[] = [
  {
    id: "AGC_hist",
    url: `${BASE}/AGC_hist_denali.tif`,
    title: "Above-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1,
    dataMax: 3792,
    dataType: "uint16",
  },
  {
    id: "AGC_ssp585",
    url: `${BASE}/AGC_ssp585_denali.tif`,
    title: "Above-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1,
    dataMax: 3846,
    dataType: "uint16",
  },
  {
    id: "BGC_hist",
    url: `${BASE}/BGC_hist_denali.tif`,
    title: "Below-ground combustion Historical",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1,
    dataMax: 5464,
    dataType: "uint16",
  },
  {
    id: "BGC_ssp585",
    url: `${BASE}/BGC_ssp585_denali.tif`,
    title: "Below-ground combustion SSP-585",
    units: "g-C/m²",
    displayScale: 1,
    dataMin: 1,
    dataMax: 5729,
    dataType: "uint16",
  },
  {
    id: "fire_risk",
    url: `${BASE}/fire_risk_denali.tif`,
    title: "Fire risk",
    units: "",
    displayScale: 1,
    dataMin: 0.02,
    dataMax: 0.74,
    dataType: "float32",
  },
  {
    id: "landcover",
    url: `${BASE}/landcover_denali.tif`,
    title: "Land cover",
    units: "",
    displayScale: 1,
    dataMin: 0,
    dataMax: 25,
    dataType: "byte",
  },
];
```

- [ ] **Step 3: Run `pnpm check` and fix any errors**

```bash
pnpm check
```

Expected: no errors. If Biome reports formatting issues, run `pnpm check:fix` then re-run `pnpm check`.

- [ ] **Step 4: Create `.env.local` and manually verify the URL fallback**

Create `.env.local` in the project root (do not commit it):

```
VITE_DATA_BASE_URL=http://localhost:8080
```

Then start the dev server and open the browser console. Confirm the URL used for tile fetches matches `http://localhost:8080/AGC_hist_denali.tif`:

```bash
pnpm dev
```

In DevTools → Network tab, filter by `.tif` — requests should go to `localhost:8080`, not `source.coop`. (Tiles won't load yet if the local COG files aren't served — network errors are expected here. The goal is to verify the URL is correct.)

To verify the fallback: rename `.env.local` to `.env.local.bak`, restart `pnpm dev`, and confirm requests go to `data.source.coop`. Then restore the file.

- [ ] **Step 5: Commit**

```bash
git add src/vite-env.d.ts src/sources.ts
git commit -m "$(cat <<'EOF'
feat(sources): swap to Denali-local layers with env-var URL override

Co-authored-by: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Document local dev workflow in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing from Task 1 (documentation only)
- Produces: nothing consumed by code

---

- [ ] **Step 1: Add a local imagery section to `CLAUDE.md`**

Open `CLAUDE.md` and insert the following section after the `## Common commands` section (before `## Render pipeline`):

```markdown
## Local development with local imagery

To use local COG files instead of source.coop, two things are needed:

**1. Start a CORS-enabled file server** (separate terminal, before `pnpm dev`):

```bash
npx serve --cors /Users/sludwig/Documents/Python/viz -l 8080
```

**2. Create `.env.local`** in the project root (gitignored — do not commit):

```
VITE_DATA_BASE_URL=http://localhost:8080
```

When `VITE_DATA_BASE_URL` is absent, `sources.ts` falls back to source.coop automatically. Delete or rename `.env.local` to switch back.

**Prerequisites:** All files in `/viz` must be Cloud-Optimized GeoTIFFs (COGs) reprojected to WGS84 (EPSG:4326). This conversion is done outside the project with GDAL.

**Render pipeline note:** `uint16` layers (AGC, BGC) render correctly. `float32` (fire_risk) and `byte` (landcover) layers appear but render with incorrect colors — Phase 2 shader support is required for those.
```

- [ ] **Step 2: Run `pnpm check`**

```bash
pnpm check
```

Expected: no errors (CLAUDE.md is not linted, but run it anyway to confirm nothing else changed).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: add local imagery dev workflow to CLAUDE.md

Co-authored-by: Claude <noreply@anthropic.com>
EOF
)"
```

---

## End-to-end verification (after both tasks)

Once the local COG files are ready and served, do a full smoke test:

1. In one terminal: `npx serve --cors /Users/sludwig/Documents/Python/viz -l 8080`
2. In another: `pnpm dev`
3. Open `http://localhost:3000`
4. Select **Above-ground combustion Historical** — map should render colored tiles over the Denali area
5. Select **Above-ground combustion SSP-585** — similar, different range
6. Select **Below-ground combustion Historical** and **SSP-585** — same
7. Select **Fire risk** — tiles load but colors are wrong (expected for Phase 2)
8. Select **Land cover** — same
9. Stop `pnpm dev`, delete `.env.local`, restart `pnpm dev` — layer dropdown should still show all six sources and requests go to `source.coop` (source.coop layers no longer exist so they'll 404 — that's expected; the goal is confirming fallback URL is used)
