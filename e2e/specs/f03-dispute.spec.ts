import { CRON_SECRET, alerts, apiBuyAndPay, apiListing, expect, money, open, staffPhone, test, type Actor } from "../support";

async function paidDuo(makeActor: (n?: string, p?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeur Litige");
  const buyer = await makeActor("Acheteur Litige");
  const item = await apiListing(seller.request);
  const orderId = await apiBuyAndPay(buyer.request, item.id);
  return { seller, buyer, item, orderId };
}
const openDispute = (orderId: string, a: Actor, text = "La robe est bien plus petite que dans l'annonce.") => a.request.post(`/api/v1/orders/${orderId}/dispute`, { data: { reason: "not_as_described", description: text } });

test.describe("F03 Litige guidé et arbitrage", () => {
  test("F03-H1 l'acheteur ouvre un litige, le vendeur répond, l'assistance rembourse", async ({ makeActor }) => {
    const { seller, buyer, item, orderId } = await paidDuo(makeActor);
    await open(buyer.page, `/orders/${orderId}`);
    await buyer.page.getByRole("link", { name: "J'ai un problème" }).click();
    await expect(buyer.page).toHaveURL(new RegExp(`/orders/${orderId}/dispute$`));
    await buyer.page.getByRole("radio", { name: /ne correspond pas à l'annonce/ }).check();
    await buyer.page.getByLabel("Décris la situation").fill("La robe est bien plus petite que dans l'annonce.");
    await buyer.page.getByRole("button", { name: "Ouvrir le litige" }).click();
    await expect(buyer.page.getByText("Litige en cours").first()).toBeVisible();
    await expect(buyer.page.getByText(/reste bloqué/).first()).toBeVisible();

    // le vendeur voit le litige et répond
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByText("Litige en cours").first()).toBeVisible();
    await seller.page.getByRole("link", { name: "Voir le litige" }).click();
    await seller.page.getByLabel("Ajouter un message").fill("Elle est pourtant en taille M comme indiqué.");
    await seller.page.getByRole("button", { name: "Envoyer" }).click();
    await expect(seller.page.getByText("Elle est pourtant en taille M")).toBeVisible();

    // l'assistance tranche
    const staff = await makeActor("Assistance", staffPhone());
    await open(staff.page, "/staff");
    await staff.page.getByRole("link", { name: /Robe/ }).first().click();
    await expect(staff.page.getByText("Elle est pourtant en taille M")).toBeVisible();
    await staff.page.getByRole("button", { name: "Rembourser l'acheteur" }).click();
    await staff.page.getByRole("button", { name: "Oui, confirmer" }).click();
    await expect(staff.page.getByText("Clos : acheteur remboursé")).toBeVisible();

    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByText("Litige clos : tu as été remboursé")).toBeVisible();
    expect((await (await buyer.request.get(`/api/v1/items/${item.id}`)).json()).item.status).toBe("active");
  });

  test("F03-E1 l'assistance paie le vendeur : argent libéré, vente terminée", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    expect((await openDispute(orderId, seller, "L'acheteur ne vient pas au rendez-vous.")).status()).toBe(201);
    const staff = await makeActor("Assistance", staffPhone());
    await open(staff.page, "/staff");
    await staff.page.getByRole("link", { name: /Robe/ }).first().click();
    await staff.page.getByRole("button", { name: "Payer le vendeur" }).click();
    await staff.page.getByLabel(/Message aux deux parties/).fill("Le vendeur était présent.");
    await staff.page.getByRole("button", { name: "Oui, confirmer" }).click();
    await expect(staff.page.getByText("Clos : vendeur payé")).toBeVisible();
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("25 $");
    await open(buyer.page, `/orders/${orderId}/dispute`);
    await expect(buyer.page.getByText("Litige clos : le vendeur est payé")).toBeVisible();
    await expect(buyer.page.getByText("Le vendeur était présent.")).toBeVisible();
  });

  test("F03-E2 formulaire vide : motif et description exigés, rien créé", async ({ makeActor }) => {
    const { buyer, orderId } = await paidDuo(makeActor);
    await open(buyer.page, `/orders/${orderId}/dispute`);
    await buyer.page.getByRole("button", { name: "Ouvrir le litige" }).click();
    await expect(alerts(buyer.page).first()).toBeVisible();
    await buyer.page.getByRole("radio", { name: "Autre problème" }).check();
    await buyer.page.getByLabel("Décris la situation").fill("court");
    await buyer.page.getByRole("button", { name: "Ouvrir le litige" }).click();
    await expect(buyer.page.getByText(/10 caractères au moins/)).toBeVisible();
    expect((await (await buyer.request.get(`/api/v1/orders/${orderId}/dispute`)).json()).dispute).toBeNull();
  });

  test("F03-E3 pendant le litige : plus d'annulation, plus de remise, pas de second litige", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    expect((await openDispute(orderId, buyer)).status()).toBe(201);
    expect((await openDispute(orderId, seller)).status()).toBe(409);
    expect((await buyer.request.post(`/api/v1/orders/${orderId}/cancel`, { data: {} })).status()).toBe(409);
    expect((await seller.request.post(`/api/v1/orders/${orderId}/confirm-delivery`, { data: { code: "123456" } })).status()).toBe(409);
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByRole("button", { name: /Annuler/ })).toHaveCount(0);
  });

  test("F03-E4 double-clic sur Ouvrir le litige : un seul litige", async ({ makeActor }) => {
    const { buyer, orderId } = await paidDuo(makeActor);
    await open(buyer.page, `/orders/${orderId}/dispute`);
    await buyer.page.getByRole("radio", { name: "L'article est abîmé" }).check();
    await buyer.page.getByLabel("Décris la situation").fill("Le talon est cassé depuis le rendez-vous.");
    await buyer.page.getByRole("button", { name: "Ouvrir le litige" }).dblclick();
    await expect(buyer.page.getByText("Litige en cours").first()).toBeVisible();
    expect((await openDispute(orderId, buyer)).status()).toBe(409);
  });

  test("F03-E5 le texte du litige est affiché tel quel (HTML inerte)", async ({ makeActor }) => {
    const { buyer, orderId } = await paidDuo(makeActor);
    const payload = `<img src=x onerror="window.__xss=1"> et <script>window.__xss=1</script>`;
    expect((await openDispute(orderId, buyer, payload)).status()).toBe(201);
    await open(buyer.page, `/orders/${orderId}/dispute`);
    await expect(buyer.page.getByText(payload)).toBeVisible();
    expect(await buyer.page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("F03-E6 tâche de remboursement des commandes jamais remises : protégée par le secret, 200 sinon", async ({ request }) => {
    const url = "/api/internal/jobs/refund_unhanded_orders";
    expect((await request.post(url)).status()).toBe(401);
    const ok = await request.post(url, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    expect(typeof (await ok.json()).result.refunded).toBe("number");
  });

  test("F03-N1 un tiers : 404 partout ; un membre ordinaire n'accède pas à l'espace assistance", async ({ makeActor, request }) => {
    const { buyer, orderId } = await paidDuo(makeActor);
    const d = (await (await openDispute(orderId, buyer)).json()).dispute;
    const tiers = await makeActor("Tiers Litige");
    expect((await tiers.request.get(`/api/v1/disputes/${d.id}`)).status()).toBe(404);
    expect((await tiers.request.post(`/api/v1/disputes/${d.id}/notes`, { data: { note: "intrus" } })).status()).toBe(404);
    expect((await tiers.request.get(`/api/v1/orders/${orderId}/dispute`)).status()).toBe(404);
    expect((await tiers.page.goto(`/orders/${orderId}/dispute`))?.status()).toBe(404);
    expect((await tiers.request.get("/api/v1/staff/disputes")).status()).toBe(404);
    expect((await tiers.request.post(`/api/v1/staff/disputes/${d.id}/resolve`, { data: { outcome: "refund_buyer" } })).status()).toBe(404);
    expect((await buyer.request.post(`/api/v1/staff/disputes/${d.id}/resolve`, { data: { outcome: "refund_buyer" } })).status()).toBe(404);
    expect((await tiers.page.goto("/staff"))?.status()).toBe(404);
    const anon = await request.get("/staff", { maxRedirects: 0 });
    expect(anon.status()).toBe(307);
    expect((await request.get("/api/v1/staff/disputes")).status()).toBe(401);
  });
});
