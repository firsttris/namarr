// Renders social-preview.html to docs/social-preview.png (1280 × 640).
// Run: bun run docs:social-preview
import path from "node:path";
import { chromium } from "@playwright/test";

const here = import.meta.dir;
const out = path.resolve(here, "../../docs/social-preview.png");
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(here, "social-preview.html")}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, type: "png" });
await browser.close();
console.log("written", out);
