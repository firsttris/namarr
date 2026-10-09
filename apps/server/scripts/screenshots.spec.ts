import * as path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { shotsData } from "./screenshots-setup";

/**
 * The README pictures docs/screenshot-dashboard.png and docs/screenshot-workbench.png, in English,
 * from the demo backend (offline catalog) and the fake files of scripts/screenshots-setup.ts:
 * two libraries, two watch folders, three hook jobs (one renamed right away, two waiting in the
 * inbox), a season of Severance in the workbench. Run: bun run docs:screenshots
 */

test.describe.configure({ mode: "serial" });

const DOCS = path.resolve("../../docs");
const at = (...segments: string[]) => path.join(shotsData, ...segments);

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(DOCS, `screenshot-${name}.png`), animations: "disabled", caret: "hide" });
}

test("libraries and watch folders", async ({ page }) => {
  await page.goto("/settings");
  for (const [folder, kind] of [
    [at("media/tv"), "series"],
    [at("media/movies"), "movies"],
  ] as const) {
    await page.getByRole("button", { name: "+ Add folder" }).click();
    const row = page.getByRole("group").last();
    await row.getByRole("textbox", { name: /^Path/ }).fill(folder);
    await row.getByLabel("Type").selectOption(kind);
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  for (const [name, folder, auto, stable] of [
    ["Movies", at("downloads/movies"), "never", "60"],
    ["TV", at("downloads/tv"), "0.9", "30"],
  ]) {
    await page.goto("/watch");
    await page.getByRole("button", { name: "Create watch folder" }).click();
    await page.locator("#w-name").fill(name!);
    await page.locator("#w-path").fill(folder!);
    await page.locator("#w-auto").selectOption(auto!);
    await page.locator("#w-stable").fill(stable!);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(folder!).first()).toBeVisible();
  }
});

test("download-client hook: one renamed, two for the inbox", async ({ request }) => {
  const jobs = [
    { path: at("hook/Dark.S01.German.DL.1080p.WEB-GRP"), target: at("media/tv") },
    { path: at("hook/The.Office.US.S03.720p.WEB.x264-GRP"), target: at("media/tv"), review: true },
    { path: at("hook/Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GRP"), target: at("media/movies"), review: true },
  ];
  for (const data of jobs) {
    const res = await request.post("/api/jobs", { data });
    expect(res.status()).toBe(202);
    const { jobId } = await res.json();
    await expect
      .poll(async () => (await (await request.get(`/api/jobs/${jobId}`)).json()).status, { timeout: 15_000 })
      .not.toMatch(/^(queued|running)$/);
  }
});

test("workbench with a season of Severance", async ({ page }) => {
  await page.goto("/rename");
  await page.getByRole("button", { name: shotsData, exact: true }).click();
  for (const s of ["downloads", "tv", "Severance.S02.German.DL.1080p.WEB-GRP"])
    await page.getByRole("button", { name: s, exact: true }).click();
  await page.getByRole("button", { name: "Create preview" }).click();
  const grid = page.getByRole("grid");
  await expect(grid.getByText("Skipped: sample file")).toBeVisible();
  await expect(grid.getByText("Hallo, Frau Cobel").first()).toBeVisible();
  await page.mouse.move(0, 0);
  await shot(page, "workbench");

  // A test run, so the dashboard lists a workbench job too
  await page.getByRole("button", { name: /^Test \d+ files$/ }).click();
  await expect(page.getByText("Test: OK").first()).toBeVisible();
});

test("dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Renamed today")).toBeVisible();
  await expect(page.getByText("Waiting for approval")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await shot(page, "dashboard");
});
