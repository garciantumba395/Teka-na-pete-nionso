import type { Page } from "@playwright/test";
import { ID, PHOTO, expect, file, jpegBuffer, open, scan, test, uniqueTitle } from "../support";

const publish = (p: Page) => p.getByRole("button", { name: "Publier l'annonce" });

async function fillSellForm(p: Page, title: string, description = "") {
  await p.locator('input[type="file"]').setInputFiles(file(await jpegBuffer(p, 400, 500)));
  await expect(p.locator(".photos-strip .thumb img")).toHaveCount(1);
  await p.getByLabel("Titre", { exact: true }).fill(title);
  if (description) await p.getByLabel("Description", { exact: true }).fill(description);
  await p.getByLabel("Catégorie", { exact: true }).selectOption({ label: "Robes" });
  await p.getByLabel("État", { exact: true }).selectOption({ label: "Très bon état" });
  await p.getByLabel(/^Prix en/).fill("25");
}

test.describe("Articles interdits", () => {
  test("AI-1 refus dans le formulaire : message de la règle, focus sur le titre, lien vers les règles, rien en ligne", async ({ makeActor }) => {
    const s = await makeActor("Vendeur interdit");
    const p = s.page;
    const title = uniqueTitle("Pistolet 9mm");
    await open(p, "/sell");
    await fillSellForm(p, title);
    await publish(p).click();
    await expect(p.locator("#title-err")).toContainText(/armes/i);
    await expect(p.getByRole("alert").filter({ hasText: "armes" }).first()).toBeVisible();
    await expect(p.locator("#title")).toBeFocused();
    await expect(p.locator("#title")).toHaveAttribute("aria-invalid", "true");
    await expect(p).toHaveURL(/\/sell$/);
    await expect(p.getByRole("link", { name: "Voir ce qu'on ne peut pas vendre" })).toBeVisible();
    // accessibilité de l'état d'erreur
    const grave = (await scan(p)).filter((i) => i.impact === "serious" || i.impact === "critical");
    expect(grave).toEqual([]);
    // rien n'est visible publiquement
    const r = await s.request.get(`/api/v1/items?q=${encodeURIComponent(title)}`);
    expect((await r.json()).items).toHaveLength(0);
    // le lien mène à la page des règles
    await p.getByRole("link", { name: "Voir ce qu'on ne peut pas vendre" }).click();
    await expect(p.getByRole("heading", { level: 1, name: "Ce qu'on ne peut pas vendre" })).toBeVisible();
  });

  test("AI-2 la description est désignée quand c'est elle qui contient l'article interdit", async ({ makeActor }) => {
    const s = await makeActor("Vendeur description");
    const p = s.page;
    await open(p, "/sell");
    await fillSellForm(p, uniqueTitle("Sac"), "Aussi de la cocaïne disponible");
    await publish(p).click();
    await expect(p.locator("#description-err")).toBeVisible();
    await expect(p.locator("#description")).toBeFocused();
    await expect(p.locator("#title-err")).toHaveCount(0);
  });

  test("AI-3 page publique des règles : libellés et explications, jamais de mots-clés", async ({ page }) => {
    await open(page, "/legal/articles-interdits");
    await expect(page.getByRole("heading", { level: 1, name: "Ce qu'on ne peut pas vendre" })).toBeVisible();
    for (const label of ["Armes et munitions", "Drogues et stupéfiants", "Médicaments", "Produits contrefaits", "Documents officiels", "Matériel volé"])
      await expect(page.getByRole("heading", { level: 2, name: label })).toBeVisible();
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const kw of ["kalachnikov", "tramadol", "bangi", "cocaine", "cocaïne", "pangolin"]) expect(text).not.toContain(kw);
    const grave = (await scan(page)).filter((i) => i.impact === "serious" || i.impact === "critical");
    expect(grave).toEqual([]);
  });

  test("AI-4 le formulaire de vente renvoie vers les règles", async ({ makeActor }) => {
    const s = await makeActor("Vendeur lien");
    await open(s.page, "/sell");
    await s.page.getByRole("link", { name: "ce qu'on ne peut pas vendre" }).click();
    await expect(s.page).toHaveURL(/\/legal\/articles-interdits$/);
  });

  test("AI-5 contournement par casse, accents, espaces et lettres espacées : refusé par l'API, brouillon conservé", async ({ makeActor }) => {
    const s = await makeActor("Vendeur contourne");
    const draft = async (title: string, description = "Article de test") => {
      const d = await s.request.post("/api/v1/items", { data: { title, description, categoryId: ID.catRobes, condition: "good", priceMinor: 1000, currency: "USD", areaId: ID.areaGombe, photos: [PHOTO] } });
      expect(d.status()).toBe(201);
      return (await d.json()).item.id as string;
    };
    for (const title of ["ARME   à   FEU", "Kalachnikov", "c o c a ï n e", "Tr@madol", "Cocaïne"]) {
      const id = await draft(title);
      const r = await s.request.post(`/api/v1/items/${id}/publish`, { data: {} });
      expect(r.status(), title).toBe(422);
      const body = await r.json();
      expect(body.error.code).toBe("PROHIBITED_ITEM");
      expect(Object.keys(body.error.details)).toEqual(["title"]);
      // le brouillon existe toujours pour son vendeur, il n'est pas public
      expect((await s.request.get(`/api/v1/items/${id}`)).status()).toBe(200);
    }
  });

  test("AI-6 faux positifs : mots voisins acceptés et publiés", async ({ makeActor }) => {
    const s = await makeActor("Vendeur légitime");
    for (const title of ["Alarme maison", "Bracelet charme", "Pistolet à colle", "Robe ivoire"]) {
      const d = await s.request.post("/api/v1/items", { data: { title: `${title} ${Date.now().toString(36)}`, description: "Couleur ivoire, achetée en Côte d'Ivoire.", categoryId: ID.catRobes, condition: "good", priceMinor: 1000, currency: "USD", areaId: ID.areaGombe, photos: [PHOTO] } });
      const id = (await d.json()).item.id;
      const r = await s.request.post(`/api/v1/items/${id}/publish`, { data: {} });
      expect(r.status(), `${title} : ${await r.text()}`).toBe(200);
    }
  });

  test("AI-7 le refus ne divulgue pas la liste des mots-clés", async ({ makeActor }) => {
    const s = await makeActor("Vendeur fuite");
    const d = await s.request.post("/api/v1/items", { data: { title: "Vends kalachnikov", description: "x", categoryId: ID.catRobes, condition: "good", priceMinor: 1000, currency: "USD", photos: [PHOTO] } });
    const id = (await d.json()).item.id;
    const body = JSON.stringify(await (await s.request.post(`/api/v1/items/${id}/publish`, { data: {} })).json()).toLowerCase();
    for (const kw of ["kalachnikov", "revolver", "carabine", "mitraillette"]) expect(body).not.toContain(kw);
    expect(body.length).toBeLessThan(600);
  });

  test("AI-8 l'écran d'administration des règles est réservé à l'équipe", async ({ makeActor }) => {
    const s = await makeActor("Membre ordinaire");
    const r = await open(s.page, "/staff/rules");
    expect(r?.status()).toBe(404);
  });
});
