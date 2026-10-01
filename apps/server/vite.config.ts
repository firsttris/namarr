import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 8420 },
  ssr: { external: ["bun:sqlite"] },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
});
