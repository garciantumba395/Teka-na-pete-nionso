import type { APIRequestContext } from "@playwright/test";
import { FEES } from "../../src/lib/fees";
import { CRON_SECRET, ID, alerts, apiBuyAndPay, apiListing, apiPay, db, expect, isPg, money, open, staffPhone, test, waitForStatus, type Actor } from "../support";

// Livraison par coursier local et libération automatique. Ce fichier est SÉRIE : les tâches planifiées lancées avec une horloge
// simulée (asOf) agissent sur toutes les commandes « livrées » du serveur de test, que seul ce fichier fabrique.
test.describe.configure({ mode: "serial" });

const MOTO = { courierName: "Papy Moto", courierPhone: "0899000111", trackingRef: "MOTO-42" };
const BEARER = { authorization: `Bearer ${CRON_SECRET}` };
const PLUS_49H = () => Date.now() + FEES.claimWindowMs + 3_600_000;

type MakeActor = (n?: string, p?: string) => Promise<Actor>;

async function apiCourierOrder(buyer: APIRequestContext, itemId: string): Promise<string> {
  const r = await buyer.post("/api/v1/orders", { data: { itemIds: [itemId], deliveryMethod: "courier", deliveryAreaId: ID.areaLimete, deliveryLandmark: "Avenue de la Paix, portail bleu" } });
  expect(r.status(), `commande : ${await r.text()}`).toBe(201);
  return (await r.json()).order.id;
}
async function courierPaid(makeActor: MakeActor) {
  const seller = await makeActor("Vendeur Coursier");
  const buyer = await makeActor("Acheteur Coursier");
  const item = await apiListing(seller.request);
  const orderId = await apiCourierOrder(buyer.request, item.id);
  expect((await apiPay(buyer.request, orderId, "0821111111")).status()).toBe(202);
  await waitForStatus(buyer.request, orderId, "paid");
  return { seller, buyer, item, orderId };
}
const shipApi = (seller: Actor, orderId: string) => seller.request.post(`/api/v1/orders/${orderId}/ship`, { data: MOTO });
async function courierShipped(makeActor: MakeActor) {
  const o = await courierPaid(makeActor);
  expect((await shipApi(o.seller, o.orderId)).status()).toBe(200);
  expect((await o.seller.request.post(`/api/v1/orders/${o.orderId}/in-transit`, { data: {} })).status()).toBe(200);
  return o;
}
async function courierReceived(makeActor: MakeActor) {
  const o = await courierShipped(makeActor);
  expect((await o.buyer.request.post(`/api/v1/orders/${o.orderId}/received`, { data: {} })).status()).toBe(200);
  return o;
}
const job = (request: APIRequestContext, name: string, asOf?: number | string) => request.post(`/api/internal/jobs/${name}${asOf !== undefined ? `?asOf=${asOf}` : ""}`, { headers: BEARER });
const view = async (a: Actor, orderId: string) => (await (await a.request.get(`/api/v1/orders/${orderId}`)).json()).order;

test.describe("F10 Livraison par coursier", () => {
  test("F10-H1 parcours complet : choix à l'achat, expédition, suivi, réception, libération par l'acheteur", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur Coursier");
    const buyer = await makeActor("Acheteur Coursier");
    const item = await apiListing(seller.request);

    // choix du mode de livraison sur la fiche
    await open(buyer.page, `/items/${item.id}`);
    await buyer.page.getByRole("radio", { name: /Livraison par coursier/ }).check();
    await buyer.page.getByLabel("Ta commune").selectOption(ID.areaLimete);
    await buyer.page.getByLabel("Repère pour le coursier").fill("Avenue de la Paix, portail bleu");
    await expect(buyer.page.getByRole("status").filter({ hasText: "Livraison :" })).toContainText("4 $");
    await expect(buyer.page.getByRole("status").filter({ hasText: "Livraison :" })).toContainText("30,25 $");
    await buyer.page.getByRole("button", { name: /^Acheter/ }).click();
    await expect(buyer.page).toHaveURL(/\/orders\/[0-9a-f-]{36}\/pay$/);
    const orderId = buyer.page.url().split("/")[4];
    expect(money(await buyer.page.locator("dd.total").innerText())).toBe("30,25 $");
    await expect(buyer.page.getByText("Livraison par coursier : l'argent reste bloqué")).toBeVisible();
    await expect(buyer.page.getByText("Livraison", { exact: true })).toBeVisible();
    await buyer.page.getByRole("button", { name: /^Payer/ }).click();
    await expect(buyer.page.getByText("Paiement reçu").first()).toBeVisible({ timeout: 20_000 });
    // pas de code de remise pour le coursier
    await expect(buyer.page.getByRole("button", { name: "Afficher mon code" })).toHaveCount(0);
    expect((await buyer.request.get(`/api/v1/orders/${orderId}/handover-code`)).status()).toBe(409);
    expect((await view(buyer, orderId)).shipment).toMatchObject({ status: "pending", courierName: null });

    // le vendeur renseigne le coursier
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByText("Paiement reçu").first()).toBeVisible();
    await expect(seller.page.locator(".otp")).toHaveCount(0);
    await seller.page.getByLabel("Nom du coursier").fill(MOTO.courierName);
    await seller.page.getByLabel("Téléphone du coursier").fill(MOTO.courierPhone);
    await seller.page.getByLabel("Référence de suivi (facultatif)").fill(MOTO.trackingRef);
    await seller.page.getByRole("button", { name: "Marquer comme remis au coursier" }).click();
    await expect(seller.page.getByRole("heading", { name: "Coursier", exact: true })).toBeVisible();
    await expect(seller.page.getByText("Colis remis au coursier").first()).toBeVisible();

    // l'acheteur voit le coursier, le suivi et l'historique
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByRole("heading", { name: "Coursier", exact: true })).toBeVisible();
    await expect(buyer.page.getByText("Papy Moto")).toBeVisible();
    await expect(buyer.page.getByRole("link", { name: "+243899000111" })).toBeVisible();
    await expect(buyer.page.getByText("MOTO-42")).toBeVisible();
    await expect(buyer.page.getByRole("heading", { name: "Historique" })).toBeVisible();
    await expect(buyer.page.getByText("Paiement reçu, l'argent est mis de côté")).toBeVisible();
    await expect(buyer.page.getByRole("button", { name: /Annuler/ })).toHaveCount(0); // le colis est parti : plus d'annulation seul
    // le vendeur marque « en route » ; la page de l'acheteur se met à jour toute seule
    await seller.page.getByRole("button", { name: "Le colis est en route" }).click();
    await expect(seller.page.getByRole("button", { name: "Le colis est en route" })).toHaveCount(0);
    await expect(buyer.page.getByText("État du colis").locator("xpath=following-sibling::dd[1]")).toHaveText("En route", { timeout: 15_000 });

    // l'acheteur confirme la réception, puis accepte : l'argent est libéré
    await buyer.page.getByRole("button", { name: "J'ai reçu mon colis" }).click();
    await expect(buyer.page.getByText("Colis reçu", { exact: true })).toBeVisible();
    await expect(buyer.page.getByText(/Sans litige de ta part/)).toBeVisible();
    await open(seller.page, "/wallet");
    await expect(seller.page.getByTestId("balance-USD")).toHaveCount(0); // pas encore libéré
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByText("Colis reçu par l'acheteur")).toBeVisible();
    await buyer.page.getByRole("button", { name: "Tout est bon, libérer l'argent" }).click();
    await expect(buyer.page.getByText("Article reçu")).toBeVisible();
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("29 $"); // agent G : articles (25 $) + frais de livraison (4 $) à remettre au coursier ; les frais de protection restent à la plateforme
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByText("Vente terminée")).toBeVisible();
    if (isPg()) {
      const kinds = (await db()!.query(`select kind from shipment_events where order_id = $1 order by seq`, [orderId])).rows.map((r) => r.kind);
      expect(kinds).toEqual(["paid", "handed_to_courier", "in_transit", "received"]);
    }
  });

  test("F10-H2 libération automatique après la fenêtre de réclamation (horloge simulée de la tâche planifiée)", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await courierReceived(makeActor);
    const o = await view(buyer, orderId);
    expect(o.status).toBe("delivered");
    expect(o.autoReleaseAt - o.deliveredAt).toBe(FEES.claimWindowMs);
    // la tâche est protégée par le secret ; l'horloge simulée est refusée si elle est illisible
    expect((await buyer.request.post("/api/internal/jobs/release_delivered_orders")).status()).toBe(401);
    expect((await job(buyer.request, "release_delivered_orders", "abc")).status()).toBe(400);
    // à l'heure réelle : rien à libérer pour cette commande
    expect((await job(buyer.request, "release_delivered_orders")).status()).toBe(200);
    expect((await view(buyer, orderId)).status).toBe("delivered");
    // 49 heures plus tard : libérée, une seule fois
    const r = await job(buyer.request, "release_delivered_orders", PLUS_49H());
    expect(r.status()).toBe(200);
    expect((await r.json()).result.released).toBeGreaterThanOrEqual(1);
    expect((await view(buyer, orderId)).status).toBe("completed");
    const again = await job(buyer.request, "release_delivered_orders", PLUS_49H());
    expect((await again.json()).result.released).toBe(0);
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("29 $"); // agent G : articles + livraison
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByText("Article reçu")).toBeVisible();
    await expect(buyer.page.getByText("Argent libéré au vendeur automatiquement (aucun litige dans le délai)")).toBeVisible();
    if (isPg()) {
      const n = (await db()!.query(`select count(*)::int as n from ledger_entries where ref_type = 'order' and ref_id = $1 and account = 'seller_available'`, [orderId])).rows[0].n;
      expect(n).toBe(1);
    }
  });

  test("F10-E1 litige pendant la fenêtre : la libération automatique est gelée, l'assistance tranche depuis « livrée »", async ({ makeActor }) => {
    const { seller, buyer, item, orderId } = await courierReceived(makeActor);
    await open(buyer.page, `/orders/${orderId}`);
    await buyer.page.getByRole("link", { name: "J'ai un problème" }).click();
    await buyer.page.getByRole("radio", { name: "L'article est abîmé" }).check();
    await buyer.page.getByLabel("Décris la situation").fill("Le talon est cassé à l'ouverture du colis.");
    await buyer.page.getByRole("button", { name: "Ouvrir le litige" }).click();
    await expect(buyer.page.getByText("Litige en cours").first()).toBeVisible();
    // la tâche, même 49 h plus tard, ne libère rien
    const r = await job(buyer.request, "release_delivered_orders", PLUS_49H());
    expect(r.status()).toBe(200);
    expect((await view(buyer, orderId)).status).toBe("disputed");
    await open(seller.page, "/wallet");
    await expect(seller.page.getByTestId("balance-USD")).toHaveCount(0);
    // l'assistance paie le vendeur : la résolution fonctionne depuis une commande livrée
    const staff = await makeActor("Assistance", staffPhone());
    await open(staff.page, "/staff");
    await staff.page.getByRole("link", { name: new RegExp(item.title) }).click();
    await staff.page.getByRole("button", { name: "Payer le vendeur" }).click();
    await staff.page.getByRole("button", { name: "Oui, confirmer" }).click();
    await expect(staff.page.getByText("Clos : vendeur payé")).toBeVisible();
    expect((await view(buyer, orderId)).status).toBe("completed");
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("29 $"); // agent G : articles + livraison
  });

  test("F10-E2 après « reçu » : seul l'acheteur peut ouvrir un litige", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await courierReceived(makeActor);
    const body = { reason: "damaged", description: "Le colis est arrivé écrasé." };
    expect((await seller.request.post(`/api/v1/orders/${orderId}/dispute`, { data: body })).status()).toBe(409);
    expect((await buyer.request.post(`/api/v1/orders/${orderId}/dispute`, { data: body })).status()).toBe(201);
  });

  test("F10-E3 colis perdu : signalement en deux temps, litige « non reçu », remboursement par l'assistance", async ({ makeActor }) => {
    const { seller, buyer, item, orderId } = await courierShipped(makeActor);
    await open(buyer.page, `/orders/${orderId}`);
    await buyer.page.getByRole("button", { name: "Colis non reçu" }).click();
    await expect(buyer.page.getByRole("alertdialog")).toBeVisible();
    await buyer.page.getByRole("button", { name: "Non, attendre encore" }).click();
    expect((await view(buyer, orderId)).status).toBe("in_delivery"); // rien n'a été signalé
    await buyer.page.getByRole("button", { name: "Colis non reçu" }).click();
    await buyer.page.getByRole("button", { name: "Oui, signaler le colis perdu" }).click();
    await expect(buyer.page.getByText("Litige en cours").first()).toBeVisible();
    const o = await view(buyer, orderId);
    expect(o.status).toBe("disputed");
    expect(o.shipment.status).toBe("lost_suspected");
    await buyer.page.getByRole("link", { name: "Voir le litige" }).click();
    await expect(buyer.page.getByText("La remise n'a pas eu lieu")).toBeVisible();
    // le vendeur voit le litige et l'historique
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByText("Colis signalé perdu, litige ouvert")).toBeVisible();
    // l'assistance rembourse
    const staff = await makeActor("Assistance", staffPhone());
    await open(staff.page, "/staff");
    await staff.page.getByRole("link", { name: new RegExp(item.title) }).click();
    await staff.page.getByRole("button", { name: "Rembourser l'acheteur" }).click();
    await staff.page.getByRole("button", { name: "Oui, confirmer" }).click();
    await expect(staff.page.getByText("Clos : acheteur remboursé")).toBeVisible();
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByText("Litige clos : tu as été remboursé")).toBeVisible();
    expect((await (await buyer.request.get(`/api/v1/items/${(await view(buyer, orderId)).items[0].id}`)).json()).item.status).toBe("active");
  });

  test("F10-E4 le vendeur peut aussi signaler un colis perdu", async ({ makeActor }) => {
    const { seller, orderId } = await courierShipped(makeActor);
    await open(seller.page, `/orders/${orderId}`);
    await seller.page.getByRole("button", { name: "Colis perdu" }).click();
    await seller.page.getByRole("button", { name: "Oui, signaler le colis perdu" }).click();
    await expect(seller.page.getByText("Litige en cours").first()).toBeVisible();
    expect((await view(seller, orderId)).status).toBe("disputed");
  });

  test("F10-E5 achat par coursier sans commune ni repère : refusé avant tout, rien n'est créé", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur Valide");
    const buyer = await makeActor("Acheteur Valide");
    const item = await apiListing(seller.request);
    await open(buyer.page, `/items/${item.id}`);
    await buyer.page.getByRole("radio", { name: /Livraison par coursier/ }).check();
    await buyer.page.getByRole("button", { name: /^Acheter/ }).click();
    await expect(alerts(buyer.page).first()).toHaveText("Choisis ta commune pour la livraison.");
    await buyer.page.getByLabel("Ta commune").selectOption(ID.areaLimete);
    await buyer.page.getByLabel("Repère pour le coursier").fill("ab");
    await buyer.page.getByRole("button", { name: /^Acheter/ }).click();
    await expect(alerts(buyer.page).first()).toContainText("repère");
    expect((await (await buyer.request.get("/api/v1/me/orders")).json()).orders).toHaveLength(0);
    // retour à la remise en main propre : l'achat classique reste possible
    await buyer.page.getByRole("radio", { name: /Remise en main propre/ }).check();
    await buyer.page.getByRole("button", { name: /^Acheter/ }).click();
    await expect(buyer.page).toHaveURL(/\/pay$/);
  });

  test("F10-N1 droits : un tiers reçoit 404, chacun son rôle, pas de coordonnées du coursier avant paiement", async ({ makeActor, request }) => {
    const seller = await makeActor("Vendeur Droits");
    const buyer = await makeActor("Acheteur Droits");
    const tiers = await makeActor("Tiers Droits");
    const item = await apiListing(seller.request);
    const orderId = await apiCourierOrder(buyer.request, item.id);
    expect((await view(buyer, orderId)).shipment).toBeNull(); // avant paiement : aucune information de coursier
    expect((await seller.request.post(`/api/v1/orders/${orderId}/ship`, { data: MOTO })).status()).toBe(409); // pas encore payée
    expect((await apiPay(buyer.request, orderId, "0821111111")).status()).toBe(202);
    await waitForStatus(buyer.request, orderId, "paid");
    const post = (a: Actor, path: string, data: unknown = {}) => a.request.post(`/api/v1/orders/${orderId}/${path}`, { data });
    for (const path of ["ship", "in-transit", "received", "lost"]) expect((await post(tiers, path, path === "ship" ? MOTO : {})).status(), `tiers ${path}`).toBe(404);
    expect((await post(buyer, "ship", MOTO)).status()).toBe(404);
    expect((await post(seller, "received")).status()).toBe(404);
    expect((await post(seller, "ship", { ...MOTO, courierPhone: "12" })).status()).toBe(422);
    expect((await post(seller, "ship", { ...MOTO, courierName: "" })).status()).toBe(422);
    expect((await post(seller, "in-transit")).status()).toBe(409);
    expect((await post(buyer, "received")).status()).toBe(409); // le colis n'est pas parti
    expect((await tiers.page.goto(`/orders/${orderId}`))?.status()).toBe(404);
    expect((await post(seller, "ship", MOTO)).status()).toBe(200);
    expect((await post(seller, "ship", MOTO)).status()).toBe(409);
    expect((await post(buyer, "cancel")).status()).toBe(409); // colis remis : plus d'annulation seul
    expect((await post(buyer, "received")).status()).toBe(200);
    expect((await post(seller, "lost")).status()).toBe(409); // déjà reçu
    // sans session : 401
    expect((await request.post(`/api/v1/orders/${orderId}/ship`, { data: MOTO })).status()).toBe(401);
  });

  test("F10-N2 remise en main propre inchangée ; expédition refusée dessus ; devis public de la livraison", async ({ makeActor, request }) => {
    const seller = await makeActor("Vendeur Main");
    const buyer = await makeActor("Acheteur Main");
    const item = await apiListing(seller.request);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    const o = await view(buyer, orderId);
    expect(o.shipment).toBeNull();
    expect(o.shippingMinor).toBe(0);
    expect(o.actions).toContain("reveal_code");
    expect((await seller.request.post(`/api/v1/orders/${orderId}/ship`, { data: MOTO })).status()).toBe(409);
    expect((await buyer.request.post(`/api/v1/orders/${orderId}/received`, { data: {} })).status()).toBe(409);
    // devis : public, même montant que la commande
    const q = await request.get(`/api/v1/shipping/quote?itemId=${item.id}&areaId=${ID.areaLimete}`);
    expect(q.status()).toBe(200);
    expect((await q.json()).quote).toEqual({ shippingMinor: 400, currency: "USD", zone: "sameCity" });
    expect((await request.get(`/api/v1/shipping/quote?itemId=${item.id}&areaId=pas-un-id`)).status()).toBe(422);
    expect((await request.get(`/api/v1/shipping/quote?itemId=${item.id}&areaId=${ID.areaGombe}`).then((r) => r.json())).quote.zone).toBe("sameCommune");
  });

  test("F10-N3 tâche de remboursement des colis jamais livrés : protégée par le secret, 200 sinon, horloge simulée refusée si invalide", async ({ request }) => {
    const url = "/api/internal/jobs/refund_stale_courier_orders";
    expect((await request.post(url)).status()).toBe(401);
    const ok = await request.post(url, { headers: BEARER });
    expect(ok.status()).toBe(200);
    expect(typeof (await ok.json()).result.refunded).toBe("number");
    expect((await request.post(`${url}?asOf=abc`, { headers: BEARER })).status()).toBe(400);
  });
});
