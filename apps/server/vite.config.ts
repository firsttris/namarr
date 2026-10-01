import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  server: { port: 8420 },
  // Bundle every dependency for the build: the Docker image ships dist/ without node_modules.
  // Dev keeps dependencies external, since the SSR module runner cannot evaluate CommonJS (react).
  ssr: command === "build" ? { noExternal: true, external: ["bun:sqlite"] } : { external: ["bun:sqlite"] },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
}));
