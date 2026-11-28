import type { APIRequestContext } from "@playwright/test";
import { ID, adminPhone, alerts, apiListing, apiPay, expect, money, open, scan, staffPhone, test, waitForStatus, type Actor } from "../support";

// Qui règle le coursier ? Mode « seller » (défaut) : les frais de livraison sont versés au vendeur à la libération.
// Mode « platform » : ils restent en attente et l'assistance les règle. Fichier SÉRIE : le mode est un réglage global du serveur,
// il n'est basculé que sur de très courtes fenêtres (avant la libération seulement) et toujours remis à « seller ».
test.describe.configure({ mode: "serial" });

type MakeActor = (n?: string, p?: string) => Promise<Actor>;
const MOTO = { courierName: "Papy Moto", courierPhone: "0899000111", trackingRef: "MOTO-42" };

async function courierOrderUpTo(makeActor: MakeActor, step: "in_transit") {
  const seller = await makeActor("Vendeur Livraison");
  const buyer = await makeActor("Acheteur Livraison");
  const item = await apiListing(seller.request, { priceMinor: 2500 });
  const r = await buyer.request.post("/api/v1/orders", { data: { itemIds: [item.id], deliveryMethod: "courier", deliveryAreaId: ID.areaLimete, deliveryLandmark: "Avenue de la Paix, portail bleu" } });
  expect(r.status(), `commande : ${await r.text()}`).toBe(201);
  const orderId = (await r.json()).order.id as string;
  expect((await apiPay(buyer.request, orderId, "0821111111")).status()).toBe(202);
  await waitForStatus(buyer.request, orderId, "paid");
  expect((await seller.request.post(`/api/v1/orders/${orderId}/ship`, { data: MOTO })).status()).toBe(200);
  if (step === "in_transit") expect((await seller.request.post(`/api/v1/orders/${orderId}/in-transit`, { data: {} })).status()).toBe(200);
  return { seller, buyer, orderId };
}
const setMode = async (admin: APIRequestContext, mode: "seller" | "platform") => {
  const r = await admin.put("/api/v1/staff/courier-fee-mode", { data: { mode } });
  expect(r.status(), `mode ${mode} : ${await r.text()}`).toBe(200);
};

test.describe("G Frais de livraison : qui règle le coursier", () => {
  test("G-H1 mode vendeur (défaut) : le vendeur voit articles + livraison à remettre, et son portefeuille les contient", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await courierOrderUpTo(makeActor, "in_transit");
    // avant la libération, l'écran annonce déjà le détail
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByTestId("seller-receives")).toContainText("Tu reçois 25 $ (articles) + 4 $ (frais de livraison à remettre au coursier)");
    expect(money(await seller.page.locator("dd.total").innerText())).toBe("29 $");
    // l'acheteur, lui, voit son total et rien de la mécanique vendeur
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByTestId("seller-receives")).toHaveCount(0);
    expect(money(await buyer.page.locator("dd.total").innerText())).toBe("30,25 $");
    expect((await buyer.request.post(`/api/v1/orders/${orderId}/received`, { data: {} })).status()).toBe(200);
    expect((await buyer.request.post(`/api/v1/orders/${orderId}/accept`, { data: {} })).status()).toBe(200);
    // portefeuille : 25 $ de vente + 4 $ de livraison, deux lignes distinctes dans l'historique
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("29 $");
    await expect(seller.page.getByText("Frais de livraison à remettre au coursier")).toBeVisible();
    await expect(seller.page.getByText("Vente", { exact: true })).toBeVisible();
    // l'écran de la commande terminée garde le détail
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByTestId("seller-receives")).toContainText("(frais de livraison à remettre au coursier)");
    // le retrait s'applique au solde total, minimum et frais inclus (10 $ + 0,10 $ de frais)
    await open(seller.page, "/wallet");
    await seller.page.locator("#amount").fill("28");
    await seller.page.getByRole("button", { name: /^Retirer/ }).click();
    await expect(seller.page.getByText("Retrait demandé")).toBeVisible();
    await expect(seller.page.getByText("Reçu").first()).toBeVisible({ timeout: 20_000 });
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("0,72 $");
    // rien à régler côté assistance pour une commande payée en mode vendeur
    const staff = await makeActor("Assistance livraison", staffPhone());
    const dues = (await (await staff.request.get("/api/v1/staff/courier-fees")).json()).dues as { orderId: string }[];
    expect(dues.map((d) => d.orderId)).not.toContain(orderId);
  });

  test("G-H2 mode plateforme : le vendeur ne reçoit que les articles ; l'assistance voit la livraison due et la marque réglée", async ({ makeActor }) => {
    test.setTimeout(120_000);
    const admin = await makeActor("Admin livraison", adminPhone());
    const { seller, buyer, orderId } = await courierOrderUpTo(makeActor, "in_transit");
    try {
      // fenêtre courte : bascule, réception, acceptation (libération), retour au mode vendeur
      await setMode(admin.request, "platform");
      expect((await buyer.request.post(`/api/v1/orders/${orderId}/received`, { data: {} })).status()).toBe(200);
      expect((await buyer.request.post(`/api/v1/orders/${orderId}/accept`, { data: {} })).status()).toBe(200);
    } finally {
      await setMode(admin.request, "seller");
    }
    // vendeur : articles seulement, la livraison est annoncée comme réglée par la plateforme
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("25 $");
    await expect(seller.page.getByText("Frais de livraison à remettre au coursier")).toHaveCount(0);
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByTestId("seller-shipping-platform")).toHaveText("Réglée par la plateforme");
    await expect(seller.page.getByTestId("seller-receives")).toHaveCount(0);
    expect(money(await seller.page.locator("dd.total").innerText())).toBe("25 $");

    // assistance : la commande figure dans la liste des frais à régler, avec le coursier
    await open(admin.page, "/staff/courier-fees");
    const due = admin.page.locator(`[data-testid="courier-due"][data-order-id="${orderId}"]`);
    await expect(due).toBeVisible();
    await expect(due).toContainText("4 $");
    await expect(due).toContainText("Papy Moto");
    const issues = (await scan(admin.page)).filter((i) => i.impact === "serious" || i.impact === "critical");
    expect(issues, JSON.stringify(issues)).toEqual([]);
    // un membre ordinaire n'a pas accès (404, ni liste ni règlement)
    expect((await seller.request.get("/api/v1/staff/courier-fees")).status()).toBe(404);
    expect((await seller.request.post(`/api/v1/staff/courier-fees/${orderId}/settle`, { data: {} })).status()).toBe(404);
    expect((await seller.page.goto("/staff/courier-fees"))?.status()).toBe(404);
    // règlement : un clic, la ligne disparaît ; un second règlement est refusé
    await open(admin.page, "/staff/courier-fees");
    await due.getByRole("button", { name: /Marquer comme réglé au coursier/ }).click();
    await expect(due).toHaveCount(0);
    await expect(alerts(admin.page)).toHaveCount(0);
    const again = await admin.request.post(`/api/v1/staff/courier-fees/${orderId}/settle`, { data: {} });
    expect(again.status()).toBe(409);
    // le portefeuille du vendeur n'a pas bougé
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("25 $");
  });

  test("G-H3 réglage : seul l'administrateur change le mode, depuis l'écran ; l'assistance ne voit pas le formulaire", async ({ makeActor }) => {
    const admin = await makeActor("Admin réglage", adminPhone());
    const staff = await makeActor("Assistance réglage", staffPhone());
    await open(staff.page, "/staff/courier-fees");
    await expect(staff.page.getByRole("heading", { name: /Frais à régler au coursier/ })).toBeVisible();
    await expect(staff.page.getByRole("heading", { name: "Qui règle le coursier ?" })).toHaveCount(0);
    expect((await staff.request.put("/api/v1/staff/courier-fee-mode", { data: { mode: "platform" } })).status()).toBe(404);
    expect((await admin.request.put("/api/v1/staff/courier-fee-mode", { data: { mode: "n'importe quoi" } })).status()).toBe(422);
    try {
      await open(admin.page, "/staff/courier-fees");
      await expect(admin.page.getByRole("radio", { name: /Le vendeur règle le coursier/ })).toBeChecked();
      const issues = (await scan(admin.page)).filter((i) => i.impact === "serious" || i.impact === "critical");
      expect(issues, JSON.stringify(issues)).toEqual([]);
      await admin.page.getByRole("radio", { name: /La plateforme règle le coursier/ }).check();
      await admin.page.getByRole("button", { name: "Enregistrer le mode" }).click();
      await expect(admin.page.getByRole("status").filter({ hasText: "Mode enregistré." })).toBeVisible();
      await expect(admin.page.getByText("Mode actuel : la plateforme règle le coursier")).toBeVisible();
      expect((await (await staff.request.get("/api/v1/staff/courier-fees")).json()).mode).toBe("platform");
    } finally {
      await setMode(admin.request, "seller");
    }
    expect((await (await staff.request.get("/api/v1/staff/courier-fees")).json()).mode).toBe("seller");
  });
});
