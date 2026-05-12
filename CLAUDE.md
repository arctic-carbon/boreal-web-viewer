# CLAUDE.md

Context for Claude Code when working in this repo.

## What this is

`boreal-web-viewer` is a client-side viewer for geospatial data layers covering boreal and arctic regions. It streams Cloud-Optimized GeoTIFFs (COGs) hosted on [source.coop](https://source.coop) and renders them in the browser with deck.gl-raster + MapLibre. Deployed at https://arctic-carbon.github.io/boreal-web-viewer/.

## Stack

- React 19 + Vite 7 + TypeScript
- `maplibre-gl` for the basemap; `@deck.gl/mapbox` overlay for raster layers
- `@developmentseed/deck.gl-raster` + `@developmentseed/deck.gl-geotiff` (npm, pinned to `0.6.1`)
- Biome for lint + format (no ESLint/Prettier). Husky pre-commit runs `biome check`.
- pnpm 10

## File map

- `src/App.tsx` — **the entire app, ~690 lines.** Layer config, shader modules, UI panels, state all live here. Notable landmarks:
  - `BASEMAPS` constant (line ~28): basemap style definitions
  - `COG_URL` (line ~56): the single data source (will become a list as multi-source support is added)
  - `Rescale` / `SetAlpha1` shader modules (~line 76+): GPU rescaling and alpha for the custom render pipeline
  - `padRows` helper (~line 129): tile padding for non-aligned overviews
  - `App()` component starts at line ~179; state hooks at ~181–194
- `src/colormap.ts` — viridis lookup texture (256 entries)
- `src/main.tsx` — React entry

## Running locally

```bash
pnpm install
pnpm dev          # serves on http://localhost:3000
```

## Render pipeline (so you don't reinvent it)

1. Tiles fetched via HTTP range requests (SourceHttp), `cache: "no-store"` is set intentionally to bypass Chrome's single-writer cache lock that otherwise serializes tile fetches.
2. Uploaded to GPU as `r16unorm` textures (0..65535 → 0.0..1.0 on read).
3. `Rescale` shader maps the raw value to [0, 1] using a user-adjustable min/max.
4. Viridis colormap applied via texture lookup.
5. Zero is treated as nodata and discarded (`SetAlpha1` enforces this).

## Conventions for changes

- **Match the existing style in `App.tsx`.** Don't reach for new dependencies (state libraries, UI kits, routers) without flagging it first.
- **Keep changes proportionate.** Don't sweep refactors into feature work. *But*: if a feature would make `App.tsx` materially worse, extract the smallest cohesive piece — e.g., a `LayerPanel` component, a `useDataSource` hook, a `sources.ts` config module — rather than piling on. The file is already at the size where new features are a good moment to split it.
- **Run `pnpm check` before declaring a change done.** This runs Biome's combined lint + format check.
- Pre-commit will run Biome on staged files via husky/lint-staged.

## In-flight workstreams

The scientist taking over development has these in motion. Be aware so suggestions don't conflict:

1. **Multi-source selection** — letting users pick from multiple data sources, possibly rendering more than one at the same time. This is the natural moment to extract a `sources` config (id, url, label, value range, colormap) out of the hardcoded `COG_URL` / `DATA_MIN` / `DATA_MAX` constants.
2. **Appearance and placement tweaks** — responding to user feedback on layout, panel positions, control styling. Treat these as iterative; show small diffs.
3. **Usage-instructions side panel** — a help/info panel explaining how to use the viewer. There's already a collapsable settings panel (`panelOpen` state, ~line 193); the usage panel may pair with it on the opposite side.

## Gotchas

- **Firefox** has a known warning surfaced in the UI for range-request handling — see existing code before changing fetch behavior.
- **Zero is nodata.** Don't change this without checking how the colormap and alpha logic handle it.
- **`cache: "no-store"` on `SourceHttp.fetch` is intentional** (see comment at the assignment) — Chromium serializes range requests under the default cache. Don't remove it.
- The data is Int16 in source but rendered as r16unorm; negative values in the source are nodata. The `DATA_MIN`/`DATA_MAX` constants were derived from `gdalinfo`.
