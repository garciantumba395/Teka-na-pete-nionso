import { alerts, apiBuyAndPay, apiComplete, apiListing, expect, open, test, type Actor } from "../support";

async function sale(makeActor: (n?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeuse Avis");
  const buyer = await makeActor("Acheteur Avis");
  const item = await apiListing(seller.request);
  const orderId = await apiComplete(buyer.request, seller.request, item.id);
  return { seller, buyer, item, orderId };
}

test.describe("F06 Avis", () => {
  test("F06-H1 l'acheteur laisse un avis, il apparaît sur le profil du vendeur et la note suit", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await sale(makeActor);
    await open(buyer.page, `/orders/${orderId}`);
    await buyer.page.getByRole("link", { name: /Donner mon avis/ }).click();
    await buyer.page.getByRole("radio", { name: /^4/ }).check({ force: true });
    await buyer.page.getByLabel(/Un mot pour les autres/).fill("Rendez-vous ponctuel, robe conforme.");
    await buyer.page.getByRole("button", { name: "Publier mon avis" }).click();
    await expect(buyer.page.getByText("Merci pour ton avis")).toBeVisible();
    await open(buyer.page, `/members/${seller.userId}`);
    await expect(buyer.page.getByRole("heading", { name: "Avis (1)" })).toBeVisible();
    await expect(buyer.page.getByText("Rendez-vous ponctuel, robe conforme.")).toBeVisible();
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByRole("link", { name: /Donner mon avis/ })).toHaveCount(0);
  });

  test("F06-E1 sans note : message clair, rien publié ; le vendeur peut noter l'acheteur", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await sale(makeActor);
    await open(buyer.page, `/orders/${orderId}/review`);
    await buyer.page.getByRole("button", { name: "Publier mon avis" }).click();
    await expect(alerts(buyer.page).first()).toContainText("Choisis une note");
    expect((await (await buyer.request.get(`/api/v1/orders/${orderId}/review`)).json()).review).toBeNull();
    const r = await seller.request.post(`/api/v1/orders/${orderId}/review`, { data: { rating: 5, comment: "Acheteur parfait" } });
    expect(r.status()).toBe(201);
  });

  test("F06-E2 un seul avis par commande, notes et textes invalides refusés", async ({ makeActor }) => {
    const { buyer, orderId } = await sale(makeActor);
    expect((await buyer.request.post(`/api/v1/orders/${orderId}/review`, { data: { rating: 5, comment: "" } })).status()).toBe(201);
    expect((await buyer.request.post(`/api/v1/orders/${orderId}/review`, { data: { rating: 1, comment: "" } })).status()).toBe(409);
    const seller2 = await makeActor("Vendeur Deux");
    const buyer2 = await makeActor("Acheteur Deux");
    const o2 = await apiComplete(buyer2.request, seller2.request, (await apiListing(seller2.request)).id);
    for (const rating of [0, 6, 2.5, "5", null]) expect((await buyer2.request.post(`/api/v1/orders/${o2}/review`, { data: { rating, comment: "" } })).status(), `note ${JSON.stringify(rating)}`).toBe(422);
    expect((await buyer2.request.post(`/api/v1/orders/${o2}/review`, { data: { rating: 3, comment: "x".repeat(501) } })).status()).toBe(422);
  });

  test("F06-E3 pas d'avis avant la fin de la vente ; la page redirige vers la commande", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur Tôt");
    const buyer = await makeActor("Acheteur Tôt");
    const orderId = await apiBuyAndPay(buyer.request, (await apiListing(seller.request)).id);
    expect((await buyer.request.post(`/api/v1/orders/${orderId}/review`, { data: { rating: 5, comment: "" } })).status()).toBe(409);
    await open(buyer.page, `/orders/${orderId}/review`);
    await expect(buyer.page).toHaveURL(new RegExp(`/orders/${orderId}$`));
  });

  test("F06-E4 un avis hostile est affiché comme du texte", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await sale(makeActor);
    const payload = `<script>window.__xss=1</script><b>gras</b>`;
    await buyer.request.post(`/api/v1/orders/${orderId}/review`, { data: { rating: 2, comment: payload } });
    await open(buyer.page, `/members/${seller.userId}`);
    await expect(buyer.page.getByText(payload)).toBeVisible();
    expect(await buyer.page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("F06-N1 un tiers ne peut ni lire ni écrire un avis sur cette commande", async ({ makeActor }) => {
    const { orderId } = await sale(makeActor);
    const tiers = await makeActor("Tiers Avis");
    expect((await tiers.request.post(`/api/v1/orders/${orderId}/review`, { data: { rating: 1, comment: "faux" } })).status()).toBe(404);
    expect((await tiers.request.get(`/api/v1/orders/${orderId}/review`)).status()).toBe(404);
    expect((await tiers.page.goto(`/orders/${orderId}/review`))?.status()).toBe(404);
  });
});
