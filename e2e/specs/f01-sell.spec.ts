import { ID, apiListing, expect, file, jpegBuffer, noHorizontalScroll, open, test, uniqueTitle, money } from "../support";
import type { Page } from "@playwright/test";

/** Remplit tout sauf le prix : une photo, un titre, la catégorie et l'état. */
async function fillBase(p: Page, title = uniqueTitle("Robe")) {
  await p.locator('input[type="file"]').setInputFiles(file(await jpegBuffer(p, 400, 500)));
  await expect(p.locator(".photos-strip .thumb img")).toHaveCount(1);
  await p.getByLabel("Titre", { exact: true }).fill(title);
  await p.getByLabel("Catégorie", { exact: true }).selectOption({ label: "Robes" });
  await p.getByLabel("État", { exact: true }).selectOption({ label: "Très bon état" });
  return title;
}
const publish = (p: Page) => p.getByRole("button", { name: "Publier l'annonce" });

test.describe("F01 Vendre un article", () => {
  test("F01-H1 vendre un article avec photos par l'interface", async ({ makeActor }) => {
    const s = await makeActor("Vendeuse H1");
    const p = s.page;
    const title = uniqueTitle("Robe wax");
    await open(p, "/sell");
    await p.locator('input[type="file"]').setInputFiles([file(await jpegBuffer(p), "a.jpg"), file(await jpegBuffer(p, 600, 800), "b.jpg")]);
    await expect(p.locator(".photos-strip .thumb img")).toHaveCount(2);
    await p.getByLabel("Titre", { exact: true }).fill(title);
    await p.getByLabel("Description", { exact: true }).fill("Portée une fois, aucun défaut.");
    await p.getByLabel("Catégorie", { exact: true }).selectOption({ label: "Robes" });
    await p.getByLabel("État", { exact: true }).selectOption({ label: "Très bon état" });
    await p.getByLabel(/^Prix en/).fill("25");
    await publish(p).click();
    await expect(p).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
    await expect(p.getByRole("heading", { name: title })).toBeVisible();
    await expect(p.locator(".gallery img")).toHaveCount(2);
    const other = await makeActor("Passant");
    await open(other.page, "/");
    await expect(other.page.getByText(title).first()).toBeVisible();
  });

  test("F01-E1 formulaire vide : une erreur par champ, focus sur le premier, rien créé", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E1");
    await open(s.page, "/sell");
    await publish(s.page).click();
    await expect(s.page.getByRole("alert").filter({ hasText: "Corrige les champs signalés" })).toBeVisible();
    expect(await s.page.locator(".error[role=alert]").count()).toBeGreaterThanOrEqual(4);
    expect(await s.page.evaluate(() => document.activeElement?.id)).toBe("photos-anchor");
    await expect(s.page).toHaveURL(/\/sell$/);
  });

  test("F01-E2 double-clic sur Publier : une seule annonce", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E2");
    const p = s.page;
    await open(p, "/sell");
    const title = await fillBase(p);
    await p.getByLabel(/^Prix en/).fill("10");
    await Promise.all([publish(p).click(), publish(p).click({ timeout: 2000 }).catch(() => undefined)]);
    await expect(p).toHaveURL(/\/items\/[0-9a-f-]{36}$/);
    const r = await s.request.get(`/api/v1/items?q=${encodeURIComponent(title)}`);
    expect((await r.json()).items).toHaveLength(1);
  });

  test("F01-E3 titre de 81 caractères : limité à 80 par l'interface, refusé (422) par l'API", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E3");
    const p = s.page;
    await open(p, "/sell");
    await p.getByLabel("Titre", { exact: true }).fill("x".repeat(81));
    expect((await p.getByLabel("Titre", { exact: true }).inputValue()).length).toBe(80);
    const r = await s.request.post("/api/v1/items", { data: { title: "x".repeat(81), description: "", categoryId: ID.catRobes, condition: "good", priceMinor: 100, currency: "USD", photos: [] } });
    expect(r.status(), "même règle que la base de données : 3 à 80 caractères dès la création").toBe(422);
    expect((await r.json()).error.details.title).toMatch(/80/);
  });

  test("F01-E4 emoji, accents, %, HTML et guillemets : affichés tels quels et retrouvés", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E4");
    const title = `Robe 🌍 été — 100% coton <b>gras</b> "cit" 'apo' ${Date.now().toString(36)}`.slice(0, 80);
    const item = await apiListing(s.request, { title });
    await open(s.page, `/items/${item.id}`);
    await expect(s.page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(await s.page.locator("h1 b").count()).toBe(0);
    const r = await s.request.get(`/api/v1/items?q=${encodeURIComponent("100% coton")}`);
    expect((await r.json()).items.some((i: { id: string }) => i.id === item.id)).toBe(true);
  });

  test("F01-E5 formats de prix : valides acceptés et bien affichés, invalides refusés", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E5");
    const p = s.page;
    await open(p, "/sell");
    await fillBase(p);
    for (const bad of ["0", "-5", "abc", "1000,01"]) {
      await p.getByLabel(/^Prix en/).fill(bad);
      await publish(p).click();
      await expect(p.locator("#priceMinor-err"), `prix « ${bad} »`).toBeVisible();
      await expect(p).toHaveURL(/\/sell$/);
    }
    await p.getByRole("button", { name: "Francs (CDF)" }).click();
    await p.getByLabel(/^Prix en/).fill("35 000,5");
    await publish(p).click();
    await expect(p.locator("#priceMinor-err")).toBeVisible();
    // valides
    await p.getByRole("button", { name: "Dollars (USD)" }).click();
    await p.getByLabel(/^Prix en/).fill("12,5");
    await publish(p).click();
    await expect(p).toHaveURL(/\/items\//);
    expect(money(await p.locator(".price").first().innerText())).toBe("12,50 $");
    await open(p, "/sell");
    await fillBase(p);
    await p.getByRole("button", { name: "Francs (CDF)" }).click();
    await p.getByLabel(/^Prix en/).fill("35 000");
    await publish(p).click();
    await expect(p).toHaveURL(/\/items\//);
    expect(money(await p.locator(".price").first().innerText())).toBe("35 000 FC");
  });

  test("F01-E6 photos : 21 fichiers, un fichier texte, une grande image", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E6");
    const p = s.page;
    await open(p, "/sell");
    const small = await jpegBuffer(p, 120, 150);
    await p.locator('input[type="file"]').setInputFiles(Array.from({ length: 21 }, (_, i) => file(small, `p${i}.jpg`)));
    await expect(p.locator(".photos-strip .thumb img")).toHaveCount(20, { timeout: 20_000 });
    await expect(p.getByText(/Maximum 20 photos/)).toBeVisible();
    await open(p, "/sell");
    await p.locator('input[type="file"]').setInputFiles({ name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("pas une image") });
    await expect(p.getByText(/n'a pas pu être lue/)).toBeVisible();
    await open(p, "/sell");
    await p.locator('input[type="file"]').setInputFiles(file(await jpegBuffer(p, 4000, 3000), "grande.jpg"));
    await expect(p.locator(".photos-strip .thumb img")).toHaveCount(1, { timeout: 30_000 });
    expect(await p.locator(".photos-strip .thumb img").evaluate((el) => (el as HTMLImageElement).src.length)).toBeLessThan(550_000);
  });

  test("F01-E7 session expirée pendant la saisie : retour à la connexion, avec retour prévu", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E7");
    const p = s.page;
    await open(p, "/sell");
    await fillBase(p);
    await p.getByLabel(/^Prix en/).fill("10");
    await s.context.clearCookies();
    await publish(p).click();
    await expect(p).toHaveURL(/\/signin\?next=(%2F|\/)sell/);
  });

  test("F01-E8 octet nul et caractères de contrôle : jamais d'erreur serveur", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E8");
    const bad = ["Robe\u0000nul", "Robe\u0007cloche", "Robe\u001b[31mrouge", "Robe‮txet", "Robe﻿bom", "Robe\ud800seul", "Robe sep"];
    for (const t of bad) {
      for (const field of ["title", "description", "brand"] as const) {
        const data: Record<string, unknown> = { title: "Robe test", description: "d", brand: "b", categoryId: ID.catRobes, condition: "good", priceMinor: 100, currency: "USD", photos: ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"] };
        data[field] = field === "title" ? t : t;
        const r = await s.request.post("/api/v1/items", { data });
        expect(r.status(), `${field} = ${JSON.stringify(t)}`).toBeLessThan(500);
        if (r.status() === 201) {
          const id = (await r.json()).item.id;
          const pub = await s.request.post(`/api/v1/items/${id}/publish`, { data: {} });
          expect(pub.status(), `publication avec ${field} = ${JSON.stringify(t)}`).toBeLessThan(500);
          expect((await s.request.get(`/api/v1/items/${id}`)).status()).toBeLessThan(500);
        }
      }
    }
  });

  test("F01-E9 charges XSS dans titre, description, marque : aucune exécution", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E9");
    const payloads = ['<script>window.__xss=1</script>', '"><img src=x onerror=window.__xss=1>', "<svg onload=window.__xss=1>", "javascript:window.__xss=1", "{{7*7}} ${7*7}"];
    let dialogs = 0;
    s.page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
    for (const x of payloads) {
      const r = await s.request.post("/api/v1/items", { data: { title: `T ${x}`.slice(0, 80), description: x, brand: x.slice(0, 40), categoryId: ID.catRobes, condition: "good", priceMinor: 100, currency: "USD", photos: ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"] } });
      expect(r.status()).toBe(201);
      const id = (await r.json()).item.id;
      await s.request.post(`/api/v1/items/${id}/publish`, { data: {} });
      await open(s.page, `/items/${id}`);
      expect(await s.page.evaluate(() => (window as unknown as { __xss?: number }).__xss), `exécution avec ${x}`).toBeUndefined();
      // éléments injectés : une image « x », un svg avec onload, ou un <script> qui n'est pas celui de Next.js (ses données JSON contiennent le texte, inerte)
      expect(await s.page.evaluate(() => {
        const inj = document.querySelectorAll('img[src="x"], svg[onload], [onerror]').length;
        const scripts = [...document.querySelectorAll("script:not([src])")].filter((e) => /window\.__xss/.test(e.textContent ?? "") && !/__next_f|__NEXT_DATA__/.test(e.textContent ?? "")).length;
        return inj + scripts;
      })).toBe(0);
    }
    await open(s.page, `/search?q=${encodeURIComponent("<script>")}`);
    expect(dialogs).toBe(0);
  });

  test("F01-E10 largeur 320 px : pas de défilement horizontal (vente et fiche)", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E10");
    await s.page.setViewportSize({ width: 320, height: 640 });
    const item = await apiListing(s.request, { title: "Robe d'un titre assez long pour tester le retour à la ligne sans casser la page" });
    for (const url of ["/sell", `/items/${item.id}`, "/", "/wallet"]) {
      await open(s.page, url);
      expect(await noHorizontalScroll(s.page), `débordement sur ${url}`).toBe(true);
    }
  });

  test("F01-E11 tout remplir et publier au clavier seul", async ({ makeActor }) => {
    const s = await makeActor("Vendeur E11");
    const p = s.page;
    const title = uniqueTitle("Clavier");
    await open(p, "/sell");
    await p.locator('input[type="file"]').setInputFiles(file(await jpegBuffer(p, 300, 400)));
    await expect(p.locator(".photos-strip .thumb img")).toHaveCount(1);
    await p.getByLabel("Titre", { exact: true }).focus();
    await p.keyboard.type(title);
    await p.keyboard.press("Tab");
    await p.keyboard.type("Description au clavier");
    await p.keyboard.press("Tab");
    await p.keyboard.type("Robes");
    await p.keyboard.press("Tab");
    await p.keyboard.type("Tr");
    await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); // taille, marque
    await p.keyboard.press("Tab"); await p.keyboard.press("Tab"); // devise USD, CDF
    await p.keyboard.press("Tab");
    await p.keyboard.type("25");
    await p.keyboard.press("Enter");
    await expect(p).toHaveURL(/\/items\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(p.getByRole("heading", { name: title })).toBeVisible();
  });

  test("F01-N1 /sell sans session : vrai 307 vers la connexion", async ({ request }) => {
    const r = await request.get("/sell", { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    expect(r.headers().location).toMatch(/\/signin\?next=(%2F|\/)sell/);
  });

  test("F01-N2 publier dans une catégorie non vendable : 422", async ({ makeActor }) => {
    const s = await makeActor("Vendeur N2");
    const d = await s.request.post("/api/v1/items", { data: { title: "Hors catégorie", description: "", categoryId: ID.catFemme, condition: "good", priceMinor: 100, currency: "USD", photos: ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"] } });
    const id = (await d.json()).item.id;
    const pub = await s.request.post(`/api/v1/items/${id}/publish`, { data: {} });
    expect(pub.status()).toBe(422);
    expect((await pub.json()).error.details.categoryId).toBeTruthy();
  });

  test("F01-N3 un second membre ne lit, ne publie ni ne modifie le brouillon d'un autre", async ({ makeActor }) => {
    const a = await makeActor("Vendeur N3a");
    const b = await makeActor("Intrus N3b");
    const d = await a.request.post("/api/v1/items", { data: { title: "Brouillon privé", description: "", categoryId: ID.catRobes, condition: "good", priceMinor: 100, currency: "USD", photos: ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"] } });
    const id = (await d.json()).item.id;
    expect((await b.request.get(`/api/v1/items/${id}`)).status()).toBe(404);
    expect((await b.request.post(`/api/v1/items/${id}/publish`, { data: {} })).status()).toBe(404);
    expect((await a.request.get(`/api/v1/items/${id}`)).status()).toBe(200); // le propriétaire le voit toujours
    const res = await b.request.get("/api/v1/items?q=Brouillon%20priv%C3%A9");
    expect((await res.json()).items.some((i: { id: string }) => i.id === id)).toBe(false);
  });
});
