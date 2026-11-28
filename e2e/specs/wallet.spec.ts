import { alerts, apiBuyAndPay, apiCode, apiListing, expect, money, open, test, type Actor } from "../support";

/** Un vendeur qui a déjà encaissé 20 $ (vente terminée). */
async function richSeller(makeActor: (n?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeur riche");
  const buyer = await makeActor("Acheteur riche");
  const item = await apiListing(seller.request, { priceMinor: 2000 });
  const orderId = await apiBuyAndPay(buyer.request, item.id);
  expect((await seller.request.post(`/api/v1/orders/${orderId}/confirm-delivery`, { data: { code: await apiCode(buyer.request, orderId) } })).status()).toBe(200);
  return seller;
}
const withdraw = (p: import("@playwright/test").Page) => p.getByRole("button", { name: /^Retirer/ });

test.describe("W Portefeuille et retrait", () => {
  test("W-H1 solde, retrait de 10 $, historique", async ({ makeActor }) => {
    const s = await richSeller(makeActor);
    await open(s.page, "/wallet");
    expect(money(await s.page.getByTestId("balance-USD").innerText())).toBe("20 $");
    await s.page.locator("#amount").fill("10");
    await withdraw(s.page).click();
    await expect(s.page.getByText("Retrait demandé")).toBeVisible();
    await expect(s.page.getByText("Reçu").first()).toBeVisible({ timeout: 20_000 });
    expect(money(await s.page.getByTestId("balance-USD").innerText())).toBe("9,90 $");
    await expect(s.page.getByText("Vente").first()).toBeVisible();
    await expect(s.page.getByText("Retrait").first()).toBeVisible();
  });

  test("W-E1 double-clic sur Retirer : un seul retrait", async ({ makeActor }) => {
    const s = await richSeller(makeActor);
    await open(s.page, "/wallet");
    await s.page.locator("#amount").fill("5");
    await Promise.all([withdraw(s.page).click(), withdraw(s.page).click({ timeout: 1500 }).catch(() => undefined)]);
    await expect(s.page.getByText("Retrait demandé")).toBeVisible();
    await expect.poll(async () => ((await (await s.request.get("/api/v1/payouts")).json()).payouts as unknown[]).length, { timeout: 10_000 }).toBe(1);
  });

  test("W-E2 retrait vers un numéro refusé : « Échoué », solde recrédité en totalité", async ({ makeActor }) => {
    const s = await richSeller(makeActor);
    await open(s.page, "/wallet");
    await s.page.locator("#amount").fill("10");
    await s.page.locator("#payout-phone").fill("810000100");
    await withdraw(s.page).click();
    await expect(s.page.getByText("Échoué").first()).toBeVisible({ timeout: 20_000 });
    expect(money(await s.page.getByTestId("balance-USD").innerText())).toBe("20 $");
  });

  test("W-E3 sous le minimum, au-delà du solde, décimales invalides, CDF avec décimales", async ({ makeActor }) => {
    const s = await richSeller(makeActor);
    await open(s.page, "/wallet");
    for (const [amount, expected] of [["4", /minimum/i], ["999", /ne couvre pas/], ["1,234", /valide/], ["abc", /valide/], ["0", /valide/]] as const) {
      await s.page.locator("#amount").fill(amount);
      await withdraw(s.page).click();
      await expect(alerts(s.page).first(), `montant « ${amount} »`).toContainText(expected);
    }
    const base = { method: "mpesa", msisdn: "0810000001", idempotencyKey: `cdf-${Date.now()}-aaaa` };
    const cdf = await s.request.post("/api/v1/payouts", { data: { ...base, currency: "CDF", amountMinor: 1_000_050 } });
    expect([409, 422]).toContain(cdf.status()); // décimales refusées, ou solde CDF insuffisant
    expect((await s.request.post("/api/v1/payouts", { data: { ...base, idempotencyKey: `x-${Date.now()}-bbbb`, currency: "USD", amountMinor: 10.5 } })).status()).toBe(422);
    expect(money(await s.page.getByTestId("balance-USD").innerText())).toBe("20 $");
  });

  test("W-E4 deux retraits simultanés de plus de la moitié du solde : un seul passe", async ({ makeActor }) => {
    const s = await richSeller(makeActor);
    const body = (k: string) => ({ method: "mpesa", msisdn: "0810000001", currency: "USD", amountMinor: 1100, idempotencyKey: `${k}-${Date.now()}` });
    const [a, b] = await Promise.all([s.request.post("/api/v1/payouts", { data: body("simul-a") }), s.request.post("/api/v1/payouts", { data: body("simul-b") })]);
    expect([a.status(), b.status()].sort()).toEqual([202, 409]);
  });

  test("W-E5 session expirée sur le portefeuille, puis Retirer : retour à la connexion", async ({ makeActor }) => {
    const s = await richSeller(makeActor);
    await open(s.page, "/wallet");
    await s.page.locator("#amount").fill("5");
    await s.context.clearCookies();
    await withdraw(s.page).click();
    await expect(s.page).toHaveURL(/\/signin/, { timeout: 10_000 });
  });

  test("W-N1 le portefeuille d'un autre membre est invisible", async ({ makeActor }) => {
    const rich = await richSeller(makeActor);
    const other = await makeActor("Curieux");
    expect(((await (await other.request.get("/api/v1/wallet")).json()).wallet.balances as unknown[]).length).toBe(0);
    expect(((await (await other.request.get("/api/v1/payouts")).json()).payouts as unknown[]).length).toBe(0);
    await open(other.page, "/wallet");
    await expect(other.page.getByText("Ton solde est vide")).toBeVisible();
    void rich;
  });
});
