import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "/boreal-web-viewer/",
  worker: { format: "es" },
  // @developmentseed/geotiff spawns a decoder worker via
  // `new Worker(new URL("./worker.js", import.meta.url))` from inside the
  // package. Vite's dep-optimizer rebundles the package into `.vite/deps/`
  // but doesn't carry that worker file with it, so the runtime fetch 404s
  // and tile decoding silently never happens. Excluding it from
  // optimization keeps the original module layout intact.
  optimizeDeps: {
    exclude: ["@developmentseed/geotiff"],
  },
  server: {
    port: 3000,
  },
});
