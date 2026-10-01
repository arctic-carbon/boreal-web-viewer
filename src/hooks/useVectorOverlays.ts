import type { Layer } from "@deck.gl/core";
import {
  GeoArrowPathLayer,
  GeoArrowSolidPolygonLayer,
} from "@geoarrow/deck.gl-geoarrow";
import wasmUrl from "@geoarrow/flatgeobuf-wasm/esm/index_bg.wasm?url";
import type { RecordBatch } from "apache-arrow";
import { tableFromIPC } from "apache-arrow";
import { useCallback, useMemo, useRef, useState } from "react";
import type { VectorSource } from "../vectorSources.js";
import { VECTOR_SOURCES } from "../vectorSources.js";

const BASE =
  import.meta.env.VITE_DATA_BASE_URL ??
  "https://data.source.coop/luddaludwig/boreal-fire-carbon";

type WasmReadFn = (bytes: Uint8Array) => { intoIPCStream(): Uint8Array };

// Module-level WASM init guard — resolved once, shared across hook calls.
let wasmInitPromise: Promise<void> | null = null;
let wasmReadFlatGeobuf: WasmReadFn | null = null;

async function getReadFn(): Promise<WasmReadFn> {
  if (wasmReadFlatGeobuf) {
    return wasmReadFlatGeobuf;
  }
  const mod = await import("@geoarrow/flatgeobuf-wasm/esm");
  if (!wasmInitPromise) {
    wasmInitPromise = mod.default(wasmUrl) as unknown as Promise<void>;
  }
  await wasmInitPromise;
  wasmReadFlatGeobuf = mod.readFlatGeobuf as WasmReadFn;
  return wasmReadFlatGeobuf;
}

type SourceBatches = { src: VectorSource; batches: RecordBatch[] };

async function loadSourceBatches(): Promise<SourceBatches[]> {
  const readFlatGeobuf = await getReadFn();
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
      return { src, batches: jsTable.batches as RecordBatch[] };
    }),
  );
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

// Builds fresh layer instances from cached batch data.
// deck.gl requires new instances each render — do not cache or reuse layers.
function buildLayers(sourceBatches: SourceBatches[]): Layer[] {
  return sourceBatches.flatMap(({ src, batches }) =>
    batches.map((batch, i) =>
      src.geomType === "line"
        ? new GeoArrowPathLayer({
            id: `vector-${src.id}-${i}`,
            data: batch,
            getColor: src.color,
            getWidth: src.width ?? 1,
            widthUnits: "pixels",
            widthMinPixels: 1,
            pickable: false,
          })
        : new GeoArrowSolidPolygonLayer({
            id: `vector-${src.id}-${i}`,
            data: batch,
            getFillColor: src.color,
            extruded: false,
            pickable: false,
          }),
    ),
  );
}

export type VectorOverlayState = {
  showOverlays: boolean;
  toggleOverlays: () => void;
  overlayLayers: Layer[];
};

export function useVectorOverlays(): VectorOverlayState {
  const [showOverlays, setShowOverlays] = useState(false);
  const cachedBatches = useRef<SourceBatches[] | null>(null);
  const [loadedBatches, setLoadedBatches] = useState<SourceBatches[] | null>(
    null,
  );

  // Fresh layer instances built from cached batch data on each visibility change.
  const overlayLayers = useMemo(
    () => (showOverlays && loadedBatches ? buildLayers(loadedBatches) : []),
    [showOverlays, loadedBatches],
  );

  const toggleOverlays = useCallback(() => {
    if (cachedBatches.current !== null) {
      setShowOverlays((prev) => !prev);
      return;
    }
    // First enable — fetch all files, cache the raw batches.
    setShowOverlays(true);
    loadSourceBatches().then((batches) => {
      cachedBatches.current = batches;
      setLoadedBatches(batches);
    });
  }, []);

  return { showOverlays, toggleOverlays, overlayLayers };
}
