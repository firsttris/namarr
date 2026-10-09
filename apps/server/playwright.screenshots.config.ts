import { defineConfig } from "@playwright/test";
import { shotsConfig, shotsData } from "./scripts/screenshots-setup";

/** The README pictures in docs/ (scripts/screenshots.spec.ts) against the demo backend: bun run docs:screenshots */
export default defineConfig({
  testDir: "scripts",
  testMatch: "screenshots.spec.ts",
  timeout: 120_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8432",
    viewport: { width: 1600, height: 960 },
    deviceScaleFactor: 2,
    locale: "en-US",
    colorScheme: "dark",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
  },
  webServer: {
    command: "bun run scripts/screenshots-setup.ts && bun run server.ts",
    url: "http://127.0.0.1:8432/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NAMARR_PORT: "8432",
      NAMARR_DEMO: "1",
      NAMARR_CONFIG_DIR: shotsConfig,
      NAMARR_ROOTS: shotsData,
      NAMARR_LOG_LEVEL: "warn",
    },
  },
});
