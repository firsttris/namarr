import * as path from "node:path";
import { defineConfig } from "@playwright/test";

const dataDir = path.resolve("e2e/.tmp");

/** Workbench flows against the demo backend (offline catalog) and fake files. */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/setup.ts",
  use: {
    baseURL: "http://127.0.0.1:8431",
    viewport: { width: 1440, height: 1000 },
    // The workbench flows read German texts; i18n.spec.ts covers English.
    locale: "de-DE",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
  },
  webServer: {
    command: "bun run server.ts",
    url: "http://127.0.0.1:8431/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NAMARR_PORT: "8431",
      NAMARR_DEMO: "1",
      NAMARR_CONFIG_DIR: path.join(dataDir, "config"),
      NAMARR_ROOTS: path.join(dataDir, "data"),
      NAMARR_LOG_LEVEL: "warn",
    },
  },
});
