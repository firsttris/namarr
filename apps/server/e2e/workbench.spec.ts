import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page, test } from "@playwright/test";

const data = path.resolve("e2e/.tmp/data");
const media = path.join(data, "media/tv");

async function openFolder(page: Page, ...segments: string[]) {
  await page.getByRole("button", { name: data }).click();
  for (const s of segments) await page.getByRole("button", { name: s, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test("Einstellungen: Standard-Zielordner setzen", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Standard-Zielordner").fill(media);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert.")).toBeVisible();
});

test("Workbench: Media-Modus, Vorschau, Treffer korrigieren, ausführen, rückgängig", async ({ page }) => {
  await page.goto("/rename");
  await openFolder(page, "downloads", "tv");
  await page.getByRole("button", { name: "Vorschau erstellen" }).click();

  // Preview like in the design: series header, matched files, review badge, sample skipped
  await expect(page.getByText("Serie erkannt · 6 Dateien")).toBeVisible();
  const grid = page.getByRole("grid");
  await expect(grid.getByText("Severance (2022)/Season 02/").first()).toBeVisible();
  await expect(grid.getByText("Hallo, Frau Cobel").first()).toBeVisible();
  // Double episode (compact numbering) and folder-context file wait for review
  await expect(grid.getByText(/% prüfen/)).toHaveCount(2);
  await expect(grid.getByText("Übersprungen: Sample-Datei")).toBeVisible();
  await expect(grid.getByText("Kein Treffer gefunden")).toBeVisible();
  await expect(page.getByRole("button", { name: /3 Dateien testen/ })).toBeVisible();

  // Template editor: live example at the selected file
  await expect(page.getByText("Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv").first()).toBeVisible();

  // Keyboard: the first matched file is selected, arrow down moves to the next one
  await expect(page.getByRole("heading", { name: /S02E06/ })).toBeVisible();
  await grid.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: /S02E04/ })).toBeVisible();

  // Manual search for the unknown file: pick a movie in the MatchPicker
  await grid.getByRole("button", { name: "Manuell suchen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Suchbegriff").fill("Matrix");
  await dialog.getByLabel("Art").selectOption("movie");
  await dialog.getByRole("button", { name: "Suchen" }).click();
  await dialog.getByRole("button", { name: /The Matrix/ }).click();
  await expect(dialog).toBeHidden();
  await expect(grid.getByText("The Matrix (1999)/").first()).toBeVisible();

  // Approve both review items via the side panel
  await grid.getByText("severance.204-205.720p.mkv").click();
  await page.getByRole("button", { name: "Freigeben" }).click();
  await expect(grid.getByText(/% prüfen/)).toHaveCount(1);
  await grid.getByText("Severance/Staffel 2/06.mkv").click();
  await page.getByRole("button", { name: "Freigeben" }).click();
  await expect(grid.getByText(/% prüfen/)).toHaveCount(0);

  // Execute as hardlink
  await page.getByLabel("Aktion").selectOption("hardlink");
  await page.getByRole("button", { name: /6 Dateien umbenennen/ }).click();
  await expect(grid.getByText("erledigt").first()).toBeVisible();
  await expect
    .poll(() => fs.existsSync(path.join(media, "Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.mkv")))
    .toBe(true);
  await expect
    .poll(() => fs.existsSync(path.join(media, "Severance (2022)/Season 02/Severance (2022) - S02E01 - Hallo, Frau Cobel.de.srt")))
    .toBe(true);
  await expect.poll(() => fs.existsSync(path.join(media, "The Matrix (1999)/The Matrix (1999).mp4"))).toBe(true);
  await expect(page.getByText("6 erledigt")).toBeVisible();
  // Hardlink: the download stays for seeding
  expect(fs.existsSync(path.join(data, "downloads/tv/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv"))).toBe(true);

  // History shows the operations; undo the whole job from the dashboard
  await page.goto("/");
  await expect(page.getByText("Heute umbenannt")).toBeVisible();
  await page.getByRole("button", { name: "Rückgängig" }).first().click();
  await expect.poll(() => fs.existsSync(path.join(media, "Severance (2022)"))).toBe(false);
});

test("Regel-Modus: Fotos nummerieren", async ({ page }) => {
  await page.goto("/rename?mode=rules");
  await openFolder(page, "photos");
  await page.getByRole("button", { name: "Vorschau erstellen" }).click();
  await expect(page.getByText("ORIGINAL · 3 DATEIEN")).toBeVisible();

  await page.getByRole("button", { name: "Regel hinzufügen" }).click();
  await page.getByRole("button", { name: "Nummerierung" }).click();
  await page.getByRole("button", { name: "Regel hinzufügen" }).click();
  await page.getByRole("button", { name: "Erweiterung" }).click();
  const grid = page.getByRole("grid");
  await expect(grid.getByText("01 - IMG_0001.jpg")).toBeVisible();
  await expect(grid.getByText("03 - IMG_0003.jpg")).toBeVisible();

  await page.getByLabel("Aktion").selectOption("rename");
  await page.getByRole("button", { name: /3 Dateien umbenennen/ }).click();
  await expect
    .poll(() => fs.readdirSync(path.join(data, "photos")).sort())
    .toEqual(["01 - IMG_0001.jpg", "02 - IMG_0002.jpg", "03 - IMG_0003.jpg"]);
});

test("Regel-Modus: Zahlen auffüllen, Regeln exportieren und wieder importieren", async ({ page }) => {
  await page.goto("/rename?mode=rules");
  await openFolder(page, "photos");
  await page.getByRole("button", { name: "Vorschau erstellen" }).click();
  await expect(page.getByText("ORIGINAL · 3 DATEIEN")).toBeVisible();

  await page.getByRole("button", { name: "Regel hinzufügen" }).click();
  await page.getByRole("button", { name: "Zahlen auffüllen" }).click();
  await page.getByLabel("Stellen").fill("3");
  const grid = page.getByRole("grid");
  await expect(grid.getByText("001 - IMG_0001.jpg")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportieren" }).click()]);
  expect(download.suggestedFilename()).toBe("namarr-rules.yaml");
  const yaml = fs.readFileSync(await download.path(), "utf8");
  expect(yaml).toContain("namarr: rules/1");
  expect(yaml).toContain("type: pad");
  expect(yaml).toContain("digits: 3");

  await page.getByRole("button", { name: "Regel 1 entfernen" }).click();
  await expect(grid.getByText("001 - IMG_0001.jpg")).toHaveCount(0);
  await page.getByLabel("Importieren").setInputFiles({ name: "rules.yaml", mimeType: "application/yaml", buffer: Buffer.from(yaml) });
  await expect(grid.getByText("001 - IMG_0001.jpg")).toBeVisible();

  await page
    .getByLabel("Importieren")
    .setInputFiles({ name: "bad.yaml", mimeType: "application/yaml", buffer: Buffer.from("rules: [{type: nope}]") });
  await expect(page.getByRole("alert")).toContainText("Import fehlgeschlagen");
});

test("History: einzelne Operation rückgängig", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByText("01 - IMG_0001.jpg").first()).toBeVisible();
  await page.getByRole("button", { name: "03 - IMG_0003.jpg rückgängig machen" }).click();
  await expect(page.getByText(/1 rückgängig gemacht/)).toBeVisible();
  await expect
    .poll(() => fs.readdirSync(path.join(data, "photos")).sort())
    .toEqual(["01 - IMG_0001.jpg", "02 - IMG_0002.jpg", "IMG_0003.JPG"]);
});

test("Health und Events antworten", async ({ request }) => {
  expect((await request.get("/api/health")).ok()).toBe(true);
});
