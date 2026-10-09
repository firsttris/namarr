// Renders social-preview.html to docs/social-preview.png (1280 × 640).
// Run: bun run docs:social-preview
import { createRequire } from "node:module";
import path from "node:path";
import type * as Playwright from "@playwright/test";

const here = import.meta.dir;
// Playwright is a dependency of apps/server, not of the root package
const { chromium } = createRequire(path.resolve(here, "../../apps/server/package.json"))("@playwright/test") as typeof Playwright;
const out = path.resolve(here, "../../docs/social-preview.png");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(here, "social-preview.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log("written", out);
