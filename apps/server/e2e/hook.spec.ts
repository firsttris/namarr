import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";

const data = path.resolve("e2e/.tmp/data");

test("Download-Client-Hook: POST /api/jobs benennt sichere Treffer sofort um", async ({ request, page }) => {
  const res = await request.post("/api/jobs", {
    data: { path: path.join(data, "hook/Dark.S01.German.DL.1080p.WEB-GRP"), target: path.join(data, "media/hook") },
  });
  expect(res.status()).toBe(202);
  const { jobId, url } = await res.json();
  expect(url).toBe(`/jobs/${jobId}`);

  await expect.poll(async () => (await (await request.get(`/api/jobs/${jobId}`)).json()).status, { timeout: 15_000 }).toBe("done");
  expect(fs.existsSync(path.join(data, "media/hook/Dark (2017)/Season 01/Dark (2017) - S01E01 - Geheimnisse.mkv"))).toBe(true);

  // Shown on the dashboard with its trigger
  await page.goto("/");
  await expect(page.getByText("Download-Client").first()).toBeVisible();

  // Errors are plain JSON
  const bad = await request.post("/api/jobs", { data: { path: "/etc", target: path.join(data, "media/hook") } });
  expect(bad.status()).toBe(403);
  expect((await bad.json()).error).toContain("outside");
  expect((await request.post("/api/jobs", { data: {} })).status()).toBe(400);
  expect((await request.get("/api/jobs/99999")).status()).toBe(404);
});
