import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", root: "packages/core", include: ["test/**/*.test.ts"] } },
      { test: { name: "providers", root: "packages/providers", include: ["test/**/*.test.ts"] } },
      // bun:sqlite: needs the Bun runtime (`bun --bun vitest`)
      { test: { name: "db", root: "packages/db", include: ["test/**/*.test.ts"] } },
      {
        resolve: { alias: { "~": new URL("./apps/server/src", import.meta.url).pathname } },
        test: { name: "server", root: "apps/server", include: ["test/**/*.test.ts"] },
      },
    ],
  },
});
