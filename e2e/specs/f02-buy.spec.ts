import { ID, alerts, apiBuyAndPay, apiCode, apiListing, apiOrder, apiPay, expect, money, open, orderStatus, test, uniqueTitle, waitForStatus, db, isPg, type Actor } from "../support";
import type { Page } from "@playwright/test";

const payBtn = (p: Page) => p.getByRole("button", { name: /^Payer/ });
const buyBtn = (p: Page) => p.getByRole("button", { name: /^Acheter/ });

/** Un vendeur avec une annonce, et un acheteur. */
async function duo(makeActor: (n?: string) => Promise<Actor>, price = 2500, currency: "USD" | "CDF" = "USD") {
  const seller = await makeActor("Vendeur");
  const buyer = await makeActor("Acheteur");
  const item = await apiListing(seller.request, { priceMinor: price, currency });
  return { seller, buyer, item };
}

test.describe("F02 Acheter un article", () => {
  test("F02-H1 acheter, payer, remettre avec le code : vente terminée et vendeur crédité", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    await open(buyer.page, `/items/${item.id}`);
    await buyBtn(buyer.page).click();
    await expect(buyer.page).toHaveURL(/\/orders\/[0-9a-f-]{36}\/pay$/);
    expect(money(await buyer.page.locator("dd.total").innerText())).toBe("26,25 $");
    await payBtn(buyer.page).click();
    await expect(buyer.page.getByText("Valide le paiement sur ton téléphone")).toBeVisible();
    await expect(buyer.page.getByText("Paiement reçu").first()).toBeVisible({ timeout: 20_000 });
    await buyer.page.getByRole("button", { name: "Afficher mon code" }).click();
    const label = await buyer.page.getByRole("img", { name: /Code de remise/ }).getAttribute("aria-label");
    const code = label!.replace(/\D/g, "");
    expect(code).toMatch(/^\d{6}$/);
    const orderId = buyer.page.url().split("/")[4];
    await open(seller.page, `/orders/${orderId}`);
    await seller.page.locator(".otp input").first().click();
    await seller.page.keyboard.type(code, { delay: 30 });
    await expect(seller.page.getByText("Vente terminée")).toBeVisible({ timeout: 15_000 });
    await expect(buyer.page.getByText("Article reçu")).toBeVisible({ timeout: 15_000 });
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("25 $");
  });

  test("F02-E1 double-clic sur Acheter : une seule commande", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    await open(buyer.page, `/items/${item.id}`);
    await Promise.all([buyBtn(buyer.page).click(), buyBtn(buyer.page).click({ timeout: 1500 }).catch(() => undefined)]);
    await expect(buyer.page).toHaveURL(/\/pay$/, { timeout: 15_000 });
    const r = await buyer.request.get("/api/v1/me/orders");
    expect((await r.json()).orders).toHaveLength(1);
  });

  test("F02-E2 double-clic sur Payer : un seul paiement, commande payée", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const orderId = await apiOrder(buyer.request, item.id);
    await open(buyer.page, `/orders/${orderId}/pay`);
    await Promise.all([payBtn(buyer.page).click(), payBtn(buyer.page).click({ timeout: 1500 }).catch(() => undefined)]);
    await expect(buyer.page.getByText("Paiement reçu").first()).toBeVisible({ timeout: 20_000 });
    await expect(alerts(buyer.page)).toHaveCount(0);
    if (isPg()) {
      const n = (await db()!.query(`select count(*)::int as n from payments where order_id = $1`, [orderId])).rows[0].n;
      expect(n).toBe(1);
    }
  });

  test("F02-E3 rafraîchir pendant l'attente : l'attente reprend, puis commande payée", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const orderId = await apiOrder(buyer.request, item.id);
    await open(buyer.page, `/orders/${orderId}/pay`);
    await payBtn(buyer.page).click();
    await expect(buyer.page.getByText("Valide le paiement sur ton téléphone")).toBeVisible();
    await buyer.page.reload();
    await expect(buyer.page.getByText(/Valide le paiement sur ton téléphone|Paiement reçu/).first()).toBeVisible();
    await expect(buyer.page.getByText("Paiement reçu").first()).toBeVisible({ timeout: 20_000 });
  });

  test("F02-E4 Retour puis Avancer depuis la page de paiement : état cohérent", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    await open(buyer.page, `/items/${item.id}`);
    await buyBtn(buyer.page).click();
    await expect(buyer.page).toHaveURL(/\/pay$/);
    await buyer.page.goBack();
    await expect(buyer.page).toHaveURL(new RegExp(`/items/${item.id}$`));
    await expect(buyer.page.getByRole("heading", { level: 1, name: item.title })).toBeVisible();
    await buyer.page.goForward();
    await expect(buyer.page).toHaveURL(/\/pay$/);
    await expect(payBtn(buyer.page)).toBeVisible();
  });

  test("F02-E5 deux acheteurs : l'un achète, l'autre reçoit un message clair puis voit « Réservé »", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const rival = await makeActor("Rival");
    await open(buyer.page, `/items/${item.id}`);
    await open(rival.page, `/items/${item.id}`);
    await buyBtn(buyer.page).click();
    await expect(buyer.page).toHaveURL(/\/pay$/);
    await buyBtn(rival.page).click();
    await expect(alerts(rival.page)).toContainText("n'est plus disponible");
    await rival.page.reload();
    await expect(rival.page.getByText("Réservé").first()).toBeVisible();
    await expect(buyBtn(rival.page)).toHaveCount(0);
  });

  test("F02-E6 numéro refusé puis numéro accepté", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const orderId = await apiOrder(buyer.request, item.id);
    await open(buyer.page, `/orders/${orderId}/pay`);
    await buyer.page.locator("#msisdn").fill("820000100");
    await payBtn(buyer.page).click();
    await expect(buyer.page.getByRole("alert").filter({ hasText: "Solde insuffisant" })).toBeVisible({ timeout: 20_000 });
    await buyer.page.locator("#msisdn").fill("821000101");
    await payBtn(buyer.page).click();
    await expect(buyer.page.getByText("Paiement reçu").first()).toBeVisible({ timeout: 20_000 });
  });

  for (const [label, offsetH] of [["en avance de 2 h", 2], ["en retard de 2 h", -2]] as const) {
    test(`F02-E7 horloge du téléphone ${label} : compte à rebours cohérent, on reste sur la page de paiement`, async ({ makeActor }) => {
      const { buyer, item } = await duo(makeActor);
      const orderId = await apiOrder(buyer.request, item.id);
      await buyer.page.clock.install({ time: new Date(Date.now() + offsetH * 3600_000) });
      await buyer.page.clock.resume();
      await open(buyer.page, `/orders/${orderId}/pay`);
      await buyer.page.waitForTimeout(2500);
      await expect(buyer.page, "la page de paiement ne doit pas être quittée à cause de l'horloge").toHaveURL(new RegExp(`/orders/${orderId}/pay$`));
      const t = (await buyer.page.getByRole("timer").first().innerText()).trim();
      const [m, sec] = t.split(":").map(Number);
      expect(m * 60 + sec, `compte à rebours affiché : ${t}`).toBeLessThanOrEqual(15 * 60);
      expect(m * 60 + sec, `compte à rebours affiché : ${t}`).toBeGreaterThan(13 * 60);
    });
  }

  test("F02-E8 perdre le réseau au moment de Payer, puis le retrouver", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const orderId = await apiOrder(buyer.request, item.id);
    await open(buyer.page, `/orders/${orderId}/pay`);
    await buyer.context.setOffline(true);
    await payBtn(buyer.page).click();
    await expect(alerts(buyer.page)).toContainText("Connexion impossible");
    await expect(payBtn(buyer.page)).toBeEnabled();
    await buyer.context.setOffline(false);
    await payBtn(buyer.page).click();
    await expect(buyer.page.getByText("Paiement reçu").first()).toBeVisible({ timeout: 20_000 });
  });

  test("F02-E9 session expirée sur la page de paiement : retour à la connexion, pas de blocage", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const orderId = await apiOrder(buyer.request, item.id);
    await open(buyer.page, `/orders/${orderId}/pay`);
    await buyer.context.clearCookies();
    await payBtn(buyer.page).click();
    await expect(buyer.page).toHaveURL(/\/signin/, { timeout: 10_000 });
  });

  test("F02-E10 l'acheteur annule avant de payer : article de nouveau achetable", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const other = await makeActor("Autre");
    const orderId = await apiOrder(buyer.request, item.id);
    await open(buyer.page, `/orders/${orderId}`);
    await buyer.page.getByRole("button", { name: "Annuler la commande" }).click();
    await buyer.page.getByRole("button", { name: "Oui, annuler" }).click();
    await expect(buyer.page.getByText("Commande annulée").first()).toBeVisible();
    await open(other.page, `/items/${item.id}`);
    await expect(buyBtn(other.page)).toBeVisible();
  });

  test("F02-E11 le vendeur annule après paiement : acheteur remboursé, article remis en vente", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    await open(seller.page, `/orders/${orderId}`);
    await seller.page.getByRole("button", { name: "Annuler la commande" }).click();
    await seller.page.getByRole("button", { name: "Oui, annuler la vente" }).click();
    await expect(seller.page.getByText("Commande annulée").first()).toBeVisible();
    expect(await orderStatus(buyer.request, orderId)).toBe("cancelled");
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByText("Tu as été remboursé en totalité")).toBeVisible();
    expect((await (await buyer.request.get(`/api/v1/items/${item.id}`)).json()).item.status).toBe("active");
  });

  test("F02-E12 l'acheteur annule après paiement, avant la remise : remboursement intégral", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    await open(buyer.page, `/orders/${orderId}`);
    await buyer.page.getByRole("button", { name: "Annuler la commande" }).click();
    await buyer.page.getByRole("button", { name: /Oui, annuler et me faire rembourser/ }).click();
    await expect(buyer.page.getByText("Tu as été remboursé en totalité")).toBeVisible();
    expect((await (await buyer.request.get(`/api/v1/items/${item.id}`)).json()).item.status).toBe("active");
    if (isPg()) {
      // seulement les écritures de CETTE commande : la base est partagée avec les autres tests en cours
      const r = await db()!.query(`select coalesce(sum(amount_minor),0)::int as s from ledger_entries where account = 'order_escrow' and (ref_id = $1 or ref_id in (select id from payments where order_id = $1))`, [orderId]);
      expect(r.rows[0].s).toBe(0);
    }
  });

  test("F02-E13 5 mauvais codes : verrouillage, même le bon code refusé, l'acheteur peut encore annuler", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    const code = await apiCode(buyer.request, orderId);
    await open(seller.page, `/orders/${orderId}`);
    for (let i = 0; i < 5; i++) {
      await seller.page.locator(".otp input").first().click();
      await seller.page.keyboard.type("000000", { delay: 20 });
      await expect(seller.page.getByRole("alert").filter({ hasText: /Code incorrect|Trop d'essais/ })).toBeVisible();
    }
    await expect(seller.page.getByText(/bloquée un moment|Trop d'essais/).first()).toBeVisible();
    const good = await seller.request.post(`/api/v1/orders/${orderId}/confirm-delivery`, { data: { code } });
    expect(good.status()).toBe(429);
    const cancel = await buyer.request.post(`/api/v1/orders/${orderId}/cancel`, { data: {} });
    expect(cancel.status()).toBe(200);
  });

  test("F02-E14 le vendeur ne peut pas lire le code de remise", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    const code = await apiCode(buyer.request, orderId);
    expect((await seller.request.get(`/api/v1/orders/${orderId}/handover-code`)).status()).toBe(404);
    await open(seller.page, `/orders/${orderId}`);
    expect(await seller.page.content()).not.toContain(code);
  });

  test("F02-E15 le vendeur ne peut pas acheter sa propre annonce", async ({ makeActor }) => {
    const { seller, item } = await duo(makeActor);
    await open(seller.page, `/items/${item.id}`);
    await expect(seller.page.getByText("C'est ton annonce")).toBeVisible();
    await expect(buyBtn(seller.page)).toHaveCount(0);
    const r = await seller.request.post("/api/v1/orders", { data: { itemIds: [item.id], deliveryMethod: "hand_delivery" } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error.code).toBe("SELF_PURCHASE");
  });

  test("F02-E16 article déjà vendu : pas de bouton, l'API refuse", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    const code = await apiCode(buyer.request, orderId);
    expect((await seller.request.post(`/api/v1/orders/${orderId}/confirm-delivery`, { data: { code } })).status()).toBe(200);
    const late = await makeActor("Retardataire");
    await open(late.page, `/items/${item.id}`);
    await expect(late.page.getByText("Vendu").first()).toBeVisible();
    await expect(buyBtn(late.page)).toHaveCount(0);
    expect((await late.request.post("/api/v1/orders", { data: { itemIds: [item.id], deliveryMethod: "hand_delivery" } })).status()).toBe(409);
  });

  test("F02-E17 totaux : prix + protection (5 %, minimum), calculés par le serveur", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur totaux");
    const buyer = await makeActor("Acheteur totaux");
    const cases: [number, "USD" | "CDF", number][] = [[2500, "USD", 2625], [10000, "USD", 10500], [100, "USD", 150], [3_500_000, "CDF", 3_675_000]];
    for (const [price, cur, total] of cases) {
      const item = await apiListing(seller.request, { priceMinor: price, currency: cur, title: uniqueTitle("Total") });
      const r = await buyer.request.post("/api/v1/orders", { data: { itemIds: [item.id], deliveryMethod: "hand_delivery" } });
      expect((await r.json()).order.totalMinor, `${price} ${cur}`).toBe(total);
      await buyer.request.post(`/api/v1/orders/${(await r.json()).order.id}/cancel`, { data: {} });
    }
  });

  test("F02-N1 un tiers ne voit pas la commande (page et API)", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    const intrus = await makeActor("Intrus");
    expect((await intrus.request.get(`/api/v1/orders/${orderId}`)).status()).toBe(404);
    const res = await open(intrus.page, `/orders/${orderId}`);
    expect(res?.status()).toBe(404);
  });

  test("F02-N2 le vendeur ouvre la page de paiement : redirigé vers la commande", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const orderId = await apiOrder(buyer.request, item.id);
    await open(seller.page, `/orders/${orderId}/pay`);
    await expect(seller.page).toHaveURL(new RegExp(`/orders/${orderId}$`));
  });

  test("F02-N3 numéro de paiement invalide : message clair, rien débité", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const orderId = await apiOrder(buyer.request, item.id);
    await open(buyer.page, `/orders/${orderId}/pay`);
    await buyer.page.locator("#msisdn").fill("123");
    await payBtn(buyer.page).click();
    await expect(alerts(buyer.page)).toContainText(/invalide|trop court/i);
    expect(await orderStatus(buyer.request, orderId)).toBe("pending_payment");
    await waitForStatus(buyer.request, orderId, "pending_payment", 2000);
  });

  void ID; void apiPay;
});
