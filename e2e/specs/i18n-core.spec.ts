import { expect, open, scan, test } from "../support";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const DESKTOP = { width: 1440, height: 900 };
const withLang = (page: import("@playwright/test").Page, value: string) => page.context().addCookies([{ name: "lang", value, url: BASE }]);

test.describe("I18N-0 Infrastructure multilingue", () => {
  test("I18N-0-1 le cookie « lang » choisit la langue : html lang, lien d'évitement et navigation", async ({ page }) => {
    await withLang(page, "en");
    await open(page, "/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Home" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sell" })).toBeVisible();
  });

  test("I18N-0-2 sans cookie, la langue du navigateur (Accept-Language) est utilisée ; sinon le français", async ({ browser }) => {
    const en = await browser.newContext({ locale: "en-GB", baseURL: BASE });
    const p1 = await en.newPage();
    await open(p1, "/");
    await expect(p1.locator("html")).toHaveAttribute("lang", "en");
    await en.close();
    const de = await browser.newContext({ locale: "de-DE", baseURL: BASE });
    const p2 = await de.newPage();
    await open(p2, "/");
    await expect(p2.locator("html")).toHaveAttribute("lang", "fr");
    await de.close();
  });

  test("I18N-0-3 un visiteur change de langue avec le sélecteur : pas de redirection vers la connexion, choix conservé au rechargement", async ({ page }) => {
    await page.setViewportSize(DESKTOP); // sur mobile, le sélecteur est dans Profil et sur la page de connexion
    await open(page, "/");
    const select = page.getByLabel("Langue").first();
    await expect(select).toBeEnabled();
    await select.selectOption("sw");
    await expect(page.locator("html")).toHaveAttribute("lang", "sw");
    await expect(page.getByRole("navigation", { name: "Urambazaji mkuu" }).getByRole("link", { name: "Nyumbani" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/signin/);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "sw");
  });

  test("I18N-0-4 les langues en bêta sont signalées dans le sélecteur", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await open(page, "/");
    const options = await page.getByLabel("Langue").first().locator("option").allInnerTexts();
    expect(options).toEqual(["Français", "English", "Lingála (bêta)", "Kiswahili (bêta)"]);
  });

  test("I18N-0-5 un membre : le choix est enregistré sur son profil et survit à l'effacement du cookie", async ({ makeActor }) => {
    const a = await makeActor("Membre Langue");
    await a.page.setViewportSize(DESKTOP);
    await open(a.page, "/");
    await a.page.getByLabel("Langue").first().selectOption("en");
    await expect(a.page.locator("html")).toHaveAttribute("lang", "en");
    await expect.poll(async () => (await (await a.request.get("/api/v1/me")).json()).user.lang).toBe("en");
    await a.context.clearCookies({ name: "lang" });
    await a.page.reload();
    await expect(a.page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("I18N-0-6 valeurs invalides : cookie inconnu = français ; API refuse une langue non prise en charge", async ({ makeActor, page }) => {
    await withLang(page, "xx");
    await open(page, "/");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const a = await makeActor("Membre Langue Deux");
    for (const lang of ["de", "", "EN", "fr; drop table", 5, null]) {
      const r = await a.request.patch("/api/v1/me", { data: { lang } });
      expect(r.status(), JSON.stringify(lang)).toBe(422);
    }
    expect((await a.request.patch("/api/v1/me", { data: { lang: "ln" } })).status()).toBe(200);
    expect((await (await a.request.get("/api/v1/me")).json()).user.lang).toBe("ln");
  });

  test("I18N-0-7 accessibilité et hydratation dans chaque langue", async ({ page }) => {
    for (const lang of ["fr", "en", "ln", "sw"]) {
      await withLang(page, lang);
      await open(page, "/");
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      const serious = (await scan(page)).filter((i) => i.impact === "serious" || i.impact === "critical");
      expect(serious, `axe en « ${lang} »`).toEqual([]);
    }
  });
});
