import type { Layer } from "@deck.gl/core";
import {
  GeoArrowPathLayer,
  GeoArrowSolidPolygonLayer,
} from "@geoarrow/deck.gl-geoarrow";
import wasmUrl from "@geoarrow/flatgeobuf-wasm/esm/index_bg.wasm?url";
import { tableFromIPC } from "apache-arrow";
import { useCallback, useRef, useState } from "react";
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

async function loadOverlayLayers(): Promise<Layer[]> {
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

      const layers: Layer[] = [];
      for (let i = 0; i < jsTable.batches.length; i++) {
        const batch = jsTable.batches[i];
        if (src.geomType === "line") {
          layers.push(
            new GeoArrowPathLayer({
              id: `vector-${src.id}-${i}`,
              data: batch,
              getColor: src.color,
              getWidth: src.width ?? 1,
              widthUnits: "pixels",
              widthMinPixels: 1,
              pickable: false,
            }),
          );
        } else {
          layers.push(
            new GeoArrowSolidPolygonLayer({
              id: `vector-${src.id}-${i}`,
              data: batch,
              getFillColor: src.color,
              extruded: false,
              pickable: false,
            }),
          );
        }
      }
      return layers;
    }),
  );

  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

export type VectorOverlayState = {
  showOverlays: boolean;
  toggleOverlays: () => void;
  overlayLayers: Layer[];
};

export function useVectorOverlays(): VectorOverlayState {
  const [showOverlays, setShowOverlays] = useState(false);
  const cachedLayers = useRef<Layer[] | null>(null);
  const [overlayLayers, setOverlayLayers] = useState<Layer[]>([]);

  const toggleOverlays = useCallback(() => {
    if (cachedLayers.current !== null) {
      setShowOverlays((prev) => {
        const next = !prev;
        setOverlayLayers(next ? (cachedLayers.current ?? []) : []);
        return next;
      });
      return;
    }
    // First enable — load all layers then cache them.
    setShowOverlays(true);
    loadOverlayLayers().then((layers) => {
      cachedLayers.current = layers;
      setOverlayLayers(layers);
    });
  }, []);

  return { showOverlays, toggleOverlays, overlayLayers };
}
