import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

/** Real browser UI; /api is proxied so browser code never calls a localhost backend. */
export default defineConfig({
  root: resolve(__dirname, "src/renderer"),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(__dirname, "src/renderer/src") } },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.VIRALHIT_API_PORT || 8787}`,
        changeOrigin: false,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  build: { outDir: resolve(__dirname, "dist/renderer"), emptyOutDir: true },
});
