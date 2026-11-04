import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "../../package.json" with { type: "json" };

export default defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  // The released version: the release workflow bumps the root package.json.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 8420 },
  // Bundle every dependency for the build: the Docker image ships dist/ without node_modules.
  // Dev keeps dependencies external, since the SSR module runner cannot evaluate CommonJS (react).
  ssr: command === "build" ? { noExternal: true, external: ["bun:sqlite"] } : { external: ["bun:sqlite"] },
  plugins: [
    // messages/{de,en}.json → src/paraglide (typed message functions); the language comes from lib/i18n.tsx
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/paraglide",
      // Paraglide 2's default: one module per locale in the dev server and tests (a few requests),
      // one per message in production builds (tree shaking). v3 would serve virtual modules only Vite
      // can resolve.
      outputStructure: process.env.NODE_ENV === "production" ? "message-modules" : "locale-modules",
      strategy: ["baseLocale"],
    }),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
}));
