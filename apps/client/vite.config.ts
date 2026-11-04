import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Link-preview crawlers need an absolute image URL, and only the operator knows the public origin.
const publicOrigin = (): Plugin => {
  let origin = "";
  return {
    name: "minesweeper-flags:public-origin",
    configResolved(config) {
      origin = (config.env.VITE_PUBLIC_ORIGIN ?? "").replace(/\/+$/, "");
    },
    transformIndexHtml: (html) => html.replaceAll("__PUBLIC_ORIGIN__", origin)
  };
};

export default defineConfig({
  plugins: [react(), publicOrigin()],
  resolve: {
    alias: {
      "@minesweeper-flags/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url)
      )
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3001",
        ws: true
      }
    }
  }
});
