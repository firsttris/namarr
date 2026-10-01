import { expect, test } from "@playwright/test";

test.describe("Englischer Browser", () => {
  test.use({ locale: "en-US" });

  test("startet auf Englisch, schon im Server-Rendering", async ({ page, request }) => {
    const html = await (await request.get("/", { headers: { "accept-language": "en-US,en;q=0.9" } })).text();
    expect(html).toContain('lang="en"');
    expect(html).toContain("Renamed today");

    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(page.getByText("Renamed today")).toBeVisible();
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Interface language" })).toHaveValue("en");
  });

  test("Umschalten auf Deutsch bleibt nach dem Neuladen", async ({ page }) => {
    await page.goto("/history");
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await page.getByRole("group", { name: "Interface language" }).getByRole("button", { name: "de" }).click();
    await expect(page.getByText("Jede Operation ist rückgängig machbar")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.reload();
    await expect(page.getByText("Jede Operation ist rückgängig machbar")).toBeVisible();
    await expect(page.getByRole("group", { name: "Sprache der Oberfläche" }).getByRole("button", { name: "de" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Server-Meldungen kommen in der gewählten Sprache", async ({ page }) => {
    await page.goto("/rename");
    await page.getByRole("button", { name: /\/data$/ }).click();
    await page.getByRole("button", { name: "downloads", exact: true }).click();
    await page.getByRole("button", { name: "tv", exact: true }).click();
    await page.getByRole("button", { name: "Create preview" }).click();
    const grid = page.getByRole("grid");
    await expect(grid.getByText("Skipped: sample file")).toBeVisible();
    await expect(grid.getByRole("button", { name: "Search manually" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Test \d+ files/ })).toBeVisible();
  });

  test("keine deutschen UI-Texte auf englischen Seiten", async ({ page }) => {
    // Words that only appear in German UI texts, never in the demo file names.
    const german =
      /\b(Aktion|Konflikte?|Ziel|Speichern|Abbrechen|Datei|Dateien|Ordner|Einstellungen|Freigeben|Regeln|Vorschau|Treffer|Wurzelpfade|Benachrichtigungen|Sprache|Neues|Noch|keine)\b/;
    const pages: [string, (() => Promise<unknown>)?][] = [
      ["/"],
      ["/inbox"],
      ["/history"],
      ["/profiles", () => page.getByRole("button", { name: "New profile" }).click()],
      ["/watch", () => page.getByRole("button", { name: "Create watch folder" }).click()],
      ["/settings"],
      ["/jobs/1"],
      ["/rename?job=1", () => page.getByRole("grid").waitFor()],
    ];
    for (const [url, open] of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await open?.();
      const text = await page.locator("body").innerText();
      expect({ url, german: text.match(german)?.[0] ?? null }).toEqual({ url, german: null });
    }
  });
});
