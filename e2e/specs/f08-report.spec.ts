import { apiListing, expect, open, signUp, staffPhone, test, uniquePhone, type Actor } from "../support";

async function duo(makeActor: (n?: string, p?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeur Signalé");
  const reporter = await makeActor("Signaleur");
  const item = await apiListing(seller.request);
  return { seller, reporter, item };
}

test.describe("F08 Signalement et modération", () => {
  test("F08-H1 signaler une annonce, la modération la masque", async ({ makeActor }) => {
    const { reporter, item } = await duo(makeActor);
    await open(reporter.page, `/items/${item.id}`);
    await reporter.page.getByRole("link", { name: "Signaler cette annonce" }).click();
    await reporter.page.getByLabel(/Pourquoi signaler/).selectOption({ label: "Arnaque ou paiement hors de l'appli" });
    await reporter.page.getByLabel(/Précisions/).fill("Le vendeur demande de payer par un autre moyen.");
    await reporter.page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(reporter.page.getByText("Merci, c'est signalé.")).toBeVisible();

    const staff = await makeActor("Assistance", staffPhone());
    await open(staff.page, "/staff");
    const card = staff.page.getByRole("listitem").filter({ hasText: item.title });
    await expect(card.getByText("Le vendeur demande de payer par un autre moyen.")).toBeVisible();
    await card.getByRole("button", { name: "Masquer l'annonce" }).click();
    await expect(staff.page.getByRole("listitem").filter({ hasText: item.title })).toHaveCount(0);
    expect((await reporter.page.goto(`/items/${item.id}`))?.status()).toBe(404);
  });

  test("F08-E1 sans motif : message clair ; doublon : même signalement ; sa propre annonce : refusé", async ({ makeActor }) => {
    const { seller, reporter, item } = await duo(makeActor);
    await open(reporter.page, `/report?type=item&id=${item.id}`);
    await reporter.page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(reporter.page.getByRole("alert").filter({ hasText: "Choisis un motif" })).toBeVisible();
    const body = { targetType: "item", targetId: item.id, reason: "scam", details: "" };
    const a = await reporter.request.post("/api/v1/reports", { data: body });
    const b = await reporter.request.post("/api/v1/reports", { data: body });
    expect(a.status()).toBe(201);
    expect(b.status()).toBe(200);
    expect((await b.json()).report.id).toBe((await a.json()).report.id);
    expect((await seller.request.post("/api/v1/reports", { data: body })).status()).toBe(409);
    expect((await reporter.request.post("/api/v1/reports", { data: { ...body, reason: "inconnu" } })).status()).toBe(422);
    expect((await reporter.request.post("/api/v1/reports", { data: { ...body, targetId: "pas-un-uuid" } })).status()).toBe(422);
  });

  test("F08-E2 suspension de 7 jours : sessions coupées, reconnexion possible mais actions refusées (403)", async ({ makeActor, browser }) => {
    const { seller, reporter } = await duo(makeActor);
    const r = await reporter.request.post("/api/v1/reports", { data: { targetType: "user", targetId: seller.userId, reason: "harassment", details: "Messages insultants." } });
    expect(r.status()).toBe(201);
    const staff = await makeActor("Assistance", staffPhone());
    await open(staff.page, "/staff");
    const card = staff.page.getByRole("listitem").filter({ hasText: "Vendeur Signalé" });
    await card.getByRole("button", { name: /Suspendre le membre/ }).click();
    await expect(staff.page.getByRole("listitem").filter({ hasText: "Messages insultants." })).toHaveCount(0);
    expect((await seller.request.get("/api/v1/conversations")).status()).toBe(401); // sessions coupées
    const again = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" }, baseURL: process.env.BASE_URL ?? "http://localhost:3100" });
    await signUp(again.request, seller.phone, "Vendeur Signalé");
    const blocked = await again.request.post("/api/v1/items", { data: { title: "Autre robe" } });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error.code).toBe("ACCOUNT_SUSPENDED");
    await again.close();
  });

  test("F08-E3 signaler un membre depuis son profil ; pas de lien sur son propre profil", async ({ makeActor }) => {
    const { seller, reporter } = await duo(makeActor);
    await open(reporter.page, `/members/${seller.userId}`);
    await reporter.page.getByRole("link", { name: "Signaler ce membre" }).click();
    await expect(reporter.page).toHaveURL(/\/report\?type=user&id=/);
    await reporter.page.getByLabel(/Pourquoi signaler/).selectOption({ label: "Harcèlement ou menaces" });
    await reporter.page.getByRole("button", { name: "Envoyer le signalement" }).click();
    await expect(reporter.page.getByText("Merci, c'est signalé.")).toBeVisible();
    await open(seller.page, `/members/${seller.userId}`);
    await expect(seller.page.getByRole("link", { name: "Signaler ce membre" })).toHaveCount(0);
  });

  test("F08-N1 un membre ordinaire n'accède ni à l'espace ni aux actions de modération ; /report exige une cible valide", async ({ makeActor, request }) => {
    const { reporter, item } = await duo(makeActor);
    const id = (await (await reporter.request.post("/api/v1/reports", { data: { targetType: "item", targetId: item.id, reason: "other", details: "" } })).json()).report.id;
    expect((await reporter.request.get("/api/v1/staff/reports")).status()).toBe(404);
    expect((await reporter.request.post(`/api/v1/staff/reports/${id}`, { data: { action: "hide_item" } })).status()).toBe(404);
    expect((await reporter.page.goto("/report"))?.status()).toBe(404);
    expect((await reporter.page.goto(`/report?type=item&id=${uniquePhone()}`))?.status()).toBe(404);
    expect((await request.post("/api/v1/reports", { data: {} })).status()).toBe(401);
    const anon = await request.get(`/report?type=item&id=${item.id}`, { maxRedirects: 0 });
    expect(anon.status()).toBe(307);
  });
});
