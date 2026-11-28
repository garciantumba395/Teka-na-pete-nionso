import { ID, apiListing, expect, open, test, uniqueTitle } from "../support";

test.describe("R Recherche", () => {
  test("R-H1 mot-clé, catégorie, prix max, rayon, combinés ; effacer un filtre", async ({ makeActor }) => {
    const s = await makeActor("Vendeur recherche");
    const tok = `Zorba${Date.now().toString(36).replace(/\d/g, "k")}`;
    const cheap = await apiListing(s.request, { title: `${tok} robe`, priceMinor: 1000, categoryId: ID.catRobes, areaId: ID.areaGombe });
    const dear = await apiListing(s.request, { title: `${tok} casque`, priceMinor: 9000, categoryId: ID.catElectro, areaId: ID.areaLimete });
    const v = await makeActor("Chercheur");
    const p = v.page;
    await open(p, `/search?q=${tok}`);
    await expect(p.getByRole("status")).toContainText("2 résultats");
    await open(p, `/search?q=${tok}&category=${ID.catElectro}`);
    await expect(p.getByRole("status")).toContainText("1 résultat");
    await expect(p.getByText(dear.title).first()).toBeVisible();
    await open(p, `/search?q=${tok}&max=50`);
    await expect(p.getByRole("status")).toContainText("1 résultat");
    await expect(p.getByText(cheap.title).first()).toBeVisible();
    await open(p, `/search?q=${tok}&area=${ID.areaGombe}&radius=3`);
    await expect(p.getByText(cheap.title).first()).toBeVisible();
    await expect(p.getByText(dear.title)).toHaveCount(0); // Limete est à plus de 3 km de Gombe
    await p.getByRole("link", { name: /Retirer le mot-clé/ }).click();
    await expect(p).not.toHaveURL(new RegExp(`q=${tok}`));
    await open(p, `/search?q=${tok}-introuvable`);
    await expect(p.getByText("Aucun résultat").first()).toBeVisible();
    await expect(p.getByRole("link", { name: "Effacer les filtres" })).toBeVisible();
  });

  test("R-E1 mot-clé de 10 000 caractères, emoji, accents : pas d'erreur", async ({ request }) => {
    for (const q of ["a".repeat(10_000), "🌍🌍🌍", "été", "ÉTÉ", "ﬁ", "i̇"]) {
      const r = await request.get(`/search?q=${encodeURIComponent(q)}`);
      expect(r.status(), `q de ${q.length} caractères`).toBeLessThan(500);
      const a = await request.get(`/api/v1/items?q=${encodeURIComponent(q)}`);
      expect(a.status()).toBeLessThan(500);
    }
  });

  test("R-E2 prix max « abc », négatif, énorme : pas d'erreur", async ({ request }) => {
    for (const max of ["abc", "-5", "99999999999999999999", "1e309", "NaN", "0"]) {
      expect((await request.get(`/search?max=${encodeURIComponent(max)}`)).status(), `max=${max}`).toBeLessThan(500);
      expect((await request.get(`/api/v1/items?max_usd=${encodeURIComponent(max)}`)).status(), `max_usd=${max}`).toBeLessThan(500);
    }
  });

  test("R-E3 zone ou catégorie invalide dans l'URL : pas de 5xx", async ({ request }) => {
    for (const qs of ["area=nope&radius=5", "category=nope", "area=nope", "radius=abc&area=" + ID.areaGombe, "radius=-3&area=" + ID.areaGombe, "radius=1e9&area=" + ID.areaGombe, "lat=abc&lng=1&radius_km=5"]) {
      expect((await request.get(`/search?${qs}`)).status(), qs).toBeLessThan(500);
      expect((await request.get(`/api/v1/items?${qs.replace("radius=", "radius_km=")}`)).status(), `api ${qs}`).toBeLessThan(500);
    }
  });

  test("R-E4 recherche par rayon : trié par distance croissante", async ({ request }) => {
    const r = await request.get(`/api/v1/items?area=${ID.areaGombe}&radius_km=15&limit=100`);
    const d = ((await r.json()).items as { distanceKm: number | null }[]).map((i) => i.distanceKm);
    expect(d.length).toBeGreaterThan(2);
    expect(d.every((x) => x !== null)).toBe(true);
    for (let i = 1; i < d.length; i++) expect(d[i]!, `rang ${i}`).toBeGreaterThanOrEqual(d[i - 1]!);
  });

  test("R-H2 marque, taille et état : filtres combinables, puces retirables, URL partageable", async ({ makeActor }) => {
    const s = await makeActor("Vendeur filtres");
    const tok = `Filtro${Date.now().toString(36).replace(/\d/g, "k")}`;
    const a = await apiListing(s.request, { title: `${tok} robe A`, brand: "Zéphyr", sizeLabel: "M", condition: "new" });
    const b = await apiListing(s.request, { title: `${tok} robe B`, brand: "Autre", sizeLabel: "L", condition: "good" });
    const v = await makeActor("Chercheur filtres");
    const p = v.page;
    await open(p, `/search?q=${tok}`);
    await expect(p.getByRole("status")).toContainText("2 résultats");
    // formulaire : marque (sans accent ni casse) + état
    await p.getByLabel("Marque").fill("zephyr");
    await p.getByRole("checkbox", { name: "Neuf sans étiquette" }).check();
    await p.getByRole("button", { name: "Rechercher" }).click();
    await expect(p.getByRole("status")).toContainText("1 résultat");
    await expect(p.getByRole("link", { name: new RegExp(a.title) })).toBeVisible();
    await expect(p.getByRole("link", { name: /Marque : zephyr/ })).toBeVisible();
    await expect(p.getByRole("link", { name: /État : Neuf sans étiquette/ })).toBeVisible();
    // retirer la puce d'état garde la marque
    await p.getByRole("link", { name: /État : Neuf sans étiquette/ }).click();
    await expect(p.getByRole("link", { name: /Marque : zephyr/ })).toBeVisible();
    await expect(p.getByRole("link", { name: /État : /})).toHaveCount(0);
    // taille exacte
    await open(p, `/search?q=${tok}&size=l`);
    await expect(p.getByRole("status")).toContainText("1 résultat");
    await expect(p.getByRole("link", { name: new RegExp(b.title) })).toBeVisible();
    await open(p, `/search?q=${tok}&brand=zephyr&size=L`);
    await expect(p.getByRole("status")).toContainText("0 résultat");
    // API : plusieurs états, valeur inconnue ignorée, jokers SQL traités comme du texte
    const ids = async (qs: string) => (await (await v.request.get(`/api/v1/items?q=${tok}&${qs}`)).json()).items.map((x: { id: string }) => x.id).sort();
    expect(await ids("condition=new,good")).toEqual([a.id, b.id].sort());
    expect(await ids("condition=inconnu")).toEqual([a.id, b.id].sort());
    expect(await ids("brand=%25")).toEqual([]);
    expect(await ids("brand=%00zephyr")).toEqual([a.id]);
  });
});
