import { apiComplete, apiListing, expect, noHorizontalScroll, open, test } from "../support";

// agent H : favoris, tri de la recherche, marques et tailles suivies (« Pour toi »).
const token = () => `Qx${Date.now().toString(36).replace(/\d/g, "k")}${Math.floor(Math.random() * 1e4).toString(36).replace(/\d/g, "j")}`;
const card = (scope: Pick<import("@playwright/test").Page, "locator">, title: string) => scope.locator(".card-wrap", { hasText: title });

test.describe("H Découverte", () => {
  test("H-1 cœur au clavier sur une carte : bascule sans naviguer, libellé et état pressé, page Favoris", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur coeur");
    const tok = token();
    const item = await apiListing(seller.request, { title: `${tok} robe` });
    const fan = await makeActor("Admirateur");
    const p = fan.page;
    await open(p, `/search?q=${tok}`);
    const heart = card(p, item.title).getByRole("button", { name: "Ajouter aux favoris" });
    await expect(heart).toBeEnabled(); // inactif avant l'hydratation, actif ensuite
    await expect(heart).toHaveAttribute("aria-pressed", "false");
    const before = p.url();
    await heart.focus();
    await p.keyboard.press("Enter");
    const on = card(p, item.title).getByRole("button", { name: "Retirer des favoris" });
    await expect(on).toHaveAttribute("aria-pressed", "true");
    expect(p.url()).toBe(before); // le cœur n'a pas ouvert l'annonce
    await expect(on).toBeFocused(); // le focus reste sur le bouton
    await expect(card(p, item.title).getByText("1 favori")).toHaveCount(1); // compteur (texte réservé aux lecteurs d'écran)
    await expect(on).toContainText("1");
    // Aller-retour à la barre d'espace.
    await p.keyboard.press("Space");
    await expect(card(p, item.title).getByRole("button", { name: "Ajouter aux favoris" })).toHaveAttribute("aria-pressed", "false");
    await p.keyboard.press("Space");
    await expect(card(p, item.title).getByRole("button", { name: "Retirer des favoris" })).toBeVisible();
    // L'état survit au rechargement et apparaît sur la fiche.
    await open(p, `/search?q=${tok}`);
    await expect(card(p, item.title).getByRole("button", { name: "Retirer des favoris" })).toHaveAttribute("aria-pressed", "true");
    await open(p, `/items/${item.id}`);
    await expect(p.getByRole("button", { name: "Retirer des favoris" })).toHaveAttribute("aria-pressed", "true");
    // Page Favoris.
    await open(p, "/favourites");
    await expect(p.getByRole("heading", { name: "Favoris" })).toBeVisible();
    await expect(card(p, item.title)).toHaveCount(1);
    await card(p, item.title).getByRole("button", { name: "Retirer des favoris" }).click();
    await expect(p.getByText("Aucun favori pour l'instant")).toBeVisible();
    expect(await noHorizontalScroll(p)).toBe(true);
  });

  test("H-2 isolation, annonce propre, idempotence, annonce vendue avec mention, limite de débit", async ({ makeActor, request }) => {
    const seller = await makeActor("Vendeuse fav");
    const a = await makeActor("Membre A");
    const b = await makeActor("Membre B");
    const tok = token();
    const item = await apiListing(seller.request, { title: `${tok} sac` });
    // Visiteur : 401 ; page Favoris : renvoi vers la connexion.
    expect((await request.post("/api/v1/favourites", { data: { itemId: item.id } })).status()).toBe(401);
    expect((await request.get("/api/v1/favourites")).status()).toBe(401);
    // Propre annonce : 409 ; annonce inconnue ou identifiant invalide : 404.
    const own = await seller.request.post("/api/v1/favourites", { data: { itemId: item.id } });
    expect([own.status(), (await own.json()).error.code]).toEqual([409, "CANNOT_FAVOURITE_OWN"]);
    expect((await a.request.post("/api/v1/favourites", { data: { itemId: "00000000-0000-4000-8000-000000000000" } })).status()).toBe(404);
    expect((await a.request.delete("/api/v1/favourites/pas-un-id")).status()).toBe(404);
    expect((await a.request.post("/api/v1/favourites", { data: { itemId: item.id, extra: 1 } })).status()).toBe(422);
    // Idempotent.
    for (let i = 0; i < 2; i++) {
      const r = await a.request.post("/api/v1/favourites", { data: { itemId: item.id } });
      expect([r.status(), (await r.json()).favouriteCount]).toEqual([200, 1]);
    }
    // Isolation : B ne voit rien, A voit son favori.
    expect((await (await b.request.get("/api/v1/favourites")).json()).items).toEqual([]);
    expect((await (await a.request.get("/api/v1/favourites")).json()).items.map((i: { id: string }) => i.id)).toEqual([item.id]);
    // Le compteur est public, l'état « favori » est propre au membre.
    const listFor = async (who: { request: typeof a.request } | null) => {
      const r = await (who ? who.request : request).get(`/api/v1/items?q=${tok}`);
      return (await r.json()).items[0] as { favouriteCount: number; favourited: boolean; own: boolean };
    };
    expect(await listFor(a)).toMatchObject({ favouriteCount: 1, favourited: true, own: false });
    expect(await listFor(b)).toMatchObject({ favouriteCount: 1, favourited: false });
    expect(await listFor(null)).toMatchObject({ favouriteCount: 1, favourited: false });
    expect(await listFor(seller)).toMatchObject({ own: true });
    // Annonce vendue : reste dans les favoris, avec la mention « Vendu ».
    await apiComplete(b.request, seller.request, item.id);
    await open(a.page, "/favourites");
    await expect(card(a.page, item.title)).toContainText("Vendu");
    // Retrait idempotent.
    for (let i = 0; i < 2; i++) expect((await a.request.delete(`/api/v1/favourites/${item.id}`)).status()).toBe(200);
    expect((await (await a.request.get("/api/v1/favourites")).json()).items).toEqual([]);
  });

  test("H-3 limite de débit des favoris : 429 au-delà de 60 écritures par 10 minutes", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur débit");
    const spam = await makeActor("Membre débit");
    const item = await apiListing(seller.request);
    let limited = 0;
    for (let i = 0; i < 64; i++) {
      const r = await spam.request.post("/api/v1/favourites", { data: { itemId: item.id } });
      if (r.status() === 429) limited++;
      else expect(r.status()).toBe(200);
    }
    expect(limited).toBeGreaterThanOrEqual(1);
  });

  test("H-4 le cœur est inactif avant hydratation, absent sur sa propre annonce, et un visiteur est renvoyé à la connexion", async ({ makeActor, request, page }) => {
    const seller = await makeActor("Vendeur SSR");
    const tok = token();
    const item = await apiListing(seller.request, { title: `${tok} veste` });
    const html = await (await request.get(`/search?q=${tok}`)).text();
    const tag = html.match(/<button[^>]*aria-label="Ajouter aux favoris"[^>]*>/)?.[0] ?? "";
    expect(tag).toContain("disabled");
    // Sur sa propre annonce : pas de cœur.
    await open(seller.page, `/search?q=${tok}`);
    await expect(seller.page.getByRole("button", { name: /favoris/ })).toHaveCount(0);
    await open(seller.page, `/items/${item.id}`);
    await expect(seller.page.getByRole("button", { name: /favoris/ })).toHaveCount(0);
    // Visiteur : le cœur mène à la connexion, puis ramène à la page.
    await open(page, `/search?q=${tok}`);
    await card(page, item.title).getByRole("button", { name: "Ajouter aux favoris" }).click();
    await expect(page).toHaveURL(/\/signin\?next=/);
    await open(page, "/favourites");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("H-5 tri : prix USD et CDF mélangés, plus aimés, valeur inconnue ignorée, pagination stable", async ({ makeActor, request }) => {
    const seller = await makeActor("Vendeur tri");
    const tok = token();
    // 8 $ < 12,50 $ (35 000 FC) < 15 $ < 20 $ (56 000 FC) < 25 $
    const p15 = await apiListing(seller.request, { title: `${tok} quinze`, priceMinor: 1500 });
    const p12 = await apiListing(seller.request, { title: `${tok} douze`, priceMinor: 3_500_000, currency: "CDF" });
    const p8 = await apiListing(seller.request, { title: `${tok} huit`, priceMinor: 800 });
    const p20 = await apiListing(seller.request, { title: `${tok} vingt`, priceMinor: 5_600_000, currency: "CDF" });
    const p25 = await apiListing(seller.request, { title: `${tok} vingtcinq`, priceMinor: 2500 });
    const ids = async (qs: string) => ((await (await request.get(`/api/v1/items?q=${tok}&${qs}`)).json()).items as { id: string }[]).map((i) => i.id);
    expect(await ids("sort=price_asc")).toEqual([p8.id, p12.id, p15.id, p20.id, p25.id].map((x) => x));
    expect(await ids("sort=price_desc")).toEqual([p25.id, p20.id, p15.id, p12.id, p8.id]);
    const newest = [p25.id, p20.id, p8.id, p12.id, p15.id];
    expect(await ids("")).toEqual(newest);
    expect(await ids("sort=recent")).toEqual(newest);
    for (const bad of ["nimporte", "PRICE_ASC", "price_asc;drop", "", "%00"]) expect(await ids(`sort=${bad}`), `sort=${bad}`).toEqual(newest);
    // Pagination : deux pages de 2 + une de 1 = la liste complète.
    const pages = [...(await ids("sort=price_asc&limit=2&offset=0")), ...(await ids("sort=price_asc&limit=2&offset=2")), ...(await ids("sort=price_asc&limit=2&offset=4"))];
    expect(pages).toEqual(await ids("sort=price_asc"));
    // Les plus aimés d'abord.
    const fan1 = await makeActor("Fan 1");
    const fan2 = await makeActor("Fan 2");
    await fan1.request.post("/api/v1/favourites", { data: { itemId: p20.id } });
    await fan2.request.post("/api/v1/favourites", { data: { itemId: p20.id } });
    await fan1.request.post("/api/v1/favourites", { data: { itemId: p15.id } });
    expect(await ids("sort=favourites")).toEqual([p20.id, p15.id, p25.id, p8.id, p12.id]);
  });

  test("H-6 tri dans l'interface : liste déroulante étiquetée, puce du tri actif, retrait de la puce", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur tri UI");
    const tok = token();
    const cheap = await apiListing(seller.request, { title: `${tok} bon marché`, priceMinor: 500 });
    const mid = await apiListing(seller.request, { title: `${tok} moyen`, priceMinor: 700_000, currency: "CDF" }); // 2,50 $
    const dear = await apiListing(seller.request, { title: `${tok} cher`, priceMinor: 4000 });
    const v = await makeActor("Chercheur tri");
    const p = v.page;
    await open(p, `/search?q=${tok}`);
    const titles = () => p.locator(".grid .card").evaluateAll((els) => els.map((e) => e.querySelector(".meta")?.textContent ?? ""));
    expect(await titles()).toEqual([dear.title, mid.title, cheap.title]); // plus récent d'abord
    await p.getByLabel("Trier par").selectOption("price_desc");
    await p.getByRole("button", { name: "Rechercher" }).click();
    await expect(p).toHaveURL(/sort=price_desc/);
    await expect(p.getByRole("link", { name: /Tri : Prix décroissant/ })).toBeVisible();
    expect(await titles()).toEqual([dear.title, cheap.title, mid.title]); // 40 $, 5 $, 2,50 $ (7 000 FC)
    await p.getByLabel("Trier par").selectOption("price_asc");
    await p.getByRole("button", { name: "Rechercher" }).click();
    await expect(p.getByRole("link", { name: /Tri : Prix croissant/ })).toBeVisible();
    expect(await titles()).toEqual([mid.title, cheap.title, dear.title]);
    await p.getByRole("link", { name: /Tri : Prix croissant/ }).click();
    await expect(p).not.toHaveURL(/sort=/);
    await expect(p.getByRole("link", { name: /Tri :/ })).toHaveCount(0);
    // Valeur inconnue dans l'URL : ignorée, aucune puce.
    await open(p, `/search?q=${tok}&sort=nimporte`);
    await expect(p.getByRole("link", { name: /Tri :/ })).toHaveCount(0);
    expect(await titles()).toEqual([dear.title, mid.title, cheap.title]);
  });

  test("H-7 personnalisation : suivre une marque et une taille, « Pour toi » sur l'accueil, retrait, invitation", async ({ makeActor, request, page }) => {
    const seller = await makeActor("Vendeur suivi");
    const tok = token();
    const brandWord = `Qüx${tok}`;
    const mine = await makeActor("Membre personnalisé");
    // Annonces : une par marque (avec accent et casse différents du suivi), une par taille, une hors suivi, une à moi.
    const byBrand = await apiListing(seller.request, { title: `${tok} par marque`, brand: brandWord, sizeLabel: "ZZ1" });
    const bySize = await apiListing(seller.request, { title: `${tok} par taille`, brand: "Autre", sizeLabel: `T${tok}` });
    const none = await apiListing(seller.request, { title: `${tok} hors suivi`, brand: "Autre", sizeLabel: "ZZ2" });
    const own = await apiListing(mine.request, { title: `${tok} la mienne`, brand: brandWord });
    const p = mine.page;
    // Rien de suivi : invitation à personnaliser ; le visiteur ne voit pas la section.
    await open(p, "/");
    await expect(p.getByRole("heading", { name: "Pour toi" })).toBeVisible();
    await expect(p.getByRole("link", { name: "Personnaliser mon fil" })).toBeVisible();
    await open(page, "/");
    await expect(page.getByRole("heading", { name: "Pour toi" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Dernières annonces" })).toBeVisible();
    // Préférences, au clavier.
    await p.getByRole("link", { name: "Personnaliser mon fil" }).click();
    await expect(p).toHaveURL(/\/me\/preferences/);
    await p.getByLabel("Ajouter une marque").fill(`  qux${tok} `);
    await p.keyboard.press("Enter");
    await expect(p.getByRole("button", { name: new RegExp(`Ne plus suivre qux${tok}`, "i") })).toBeVisible();
    await p.getByLabel("Ajouter une taille").fill(`t${tok}`);
    await p.keyboard.press("Enter");
    await expect(p.getByRole("button", { name: new RegExp(`Ne plus suivre t${tok}`, "i") })).toBeVisible();
    // Le même nom avec une autre casse ou un accent ne crée pas de doublon.
    await p.getByLabel("Ajouter une marque").fill(`QÜX${tok}`);
    await p.keyboard.press("Enter");
    await expect(p.locator(".follow-list").first().locator("li")).toHaveCount(1);
    // Accueil : « Pour toi » contient marque et taille, pas la mienne ni la hors-suivi, et chaque annonce n'apparaît qu'une fois.
    await open(p, "/");
    const forYou = p.locator("section.for-you");
    await expect(forYou.getByRole("heading", { name: "Pour toi" })).toBeVisible();
    await expect(card(forYou as never, byBrand.title)).toHaveCount(1);
    await expect(card(forYou as never, bySize.title)).toHaveCount(1);
    await expect(forYou.getByText(none.title)).toHaveCount(0);
    await expect(forYou.getByText(own.title)).toHaveCount(0);
    await expect(p.getByText(byBrand.title)).toHaveCount(1); // pas de doublon avec « Dernières annonces »
    await expect(p.getByText(bySize.title)).toHaveCount(1);
    expect(await forYou.locator("li").count()).toBeLessThanOrEqual(12);
    // API : validation et plafond.
    expect((await mine.request.post("/api/v1/me/follows", { data: { kind: "color", value: "rouge" } })).status()).toBe(422);
    expect((await mine.request.post("/api/v1/me/follows", { data: { kind: "brand", value: "   " } })).status()).toBe(422);
    expect((await mine.request.post("/api/v1/me/follows", { data: { kind: "brand", value: "x".repeat(41) } })).status()).toBe(422);
    expect((await request.get("/api/v1/me/follows")).status()).toBe(401);
    for (let i = 0; i < 9; i++) expect((await mine.request.post("/api/v1/me/follows", { data: { kind: "size", value: `Taille ${i}` } })).status()).toBe(200); // 1 + 9 = 10
    const over = await mine.request.post("/api/v1/me/follows", { data: { kind: "size", value: "Taille 10" } });
    expect([over.status(), (await over.json()).error.code]).toEqual([422, "FOLLOW_LIMIT"]);
    // Retrait de la marque au clic : l'annonce par marque quitte « Pour toi ».
    await open(p, "/me/preferences");
    await p.getByRole("button", { name: new RegExp(`Ne plus suivre qux${tok}`, "i") }).click();
    await expect(p.getByText(`Tu ne suis plus qux${tok}`, { exact: false })).toBeAttached();
    await open(p, "/");
    await expect(card(p.locator("section.for-you") as never, byBrand.title)).toHaveCount(0);
  });

  test("H-8 écrans sans débordement à 320 px", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur 320");
    const tok = token();
    const item = await apiListing(seller.request, { title: `${tok} robe très longue pour tester une carte étroite`, brand: tok });
    const m = await makeActor("Membre 320");
    await m.page.setViewportSize({ width: 320, height: 640 });
    await m.request.post("/api/v1/favourites", { data: { itemId: item.id } });
    await m.request.post("/api/v1/me/follows", { data: { kind: "brand", value: tok } });
    for (const url of ["/", "/favourites", "/me/preferences", `/search?q=${tok}&sort=price_asc`, `/items/${item.id}`, "/me"]) {
      await open(m.page, url);
      expect(await noHorizontalScroll(m.page), url).toBe(true);
    }
  });
});
