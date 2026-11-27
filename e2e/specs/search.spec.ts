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
});
