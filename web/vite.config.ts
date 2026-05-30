import { defineConfig } from "vite";

// PWA frontend. Source in web/, builds to web/dist (served by the Worker).
export default defineConfig({
  root: __dirname,
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // During `vite dev`, proxy API calls to a locally running `wrangler dev`.
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
