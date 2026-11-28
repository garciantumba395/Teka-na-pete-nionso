import type { APIRequestContext } from "@playwright/test";
import { CRON_SECRET, ID, PHOTO, apiBuyAndPay, apiListing, apiPay, expect, open, scan, staffPhone, test, waitForStatus, type Actor } from "../support";

// Notifications ajoutées : annulation encadrée, livraison par coursier, photos de messagerie, preuves de litige, annonce masquée.
// Chaque test échoue sur erreur console (dont une erreur d'hydratation de la pastille) ou réponse 5xx.
// Aucune tâche planifiée avec horloge simulée ici : elles agissent sur toutes les commandes du serveur de test (voir la suite de contrat pour les délais).

interface Row { id: string; kind: string; title: string; body: string; href: string | null; read: boolean }
const feed = async (a: Actor): Promise<{ unreadCount: number; notifications: Row[] }> => {
  const r = await a.request.get("/api/v1/notifications");
  expect(r.status()).toBe(200);
  return r.json();
};
const kindsOf = async (a: Actor, kind: string) => (await feed(a)).notifications.filter((n) => n.kind === kind);
const mobileNav = (a: Actor) => a.page.getByRole("navigation", { name: "Navigation principale (mobile)" });
const unread = (label: string, n: number) => new RegExp(`^${label} ?, ${n} notifications? non lues?$`);
const post = (a: Actor, orderId: string, path: string, data: object = {}) => a.request.post(`/api/v1/orders/${orderId}/${path}`, { data });
const MOTO = { courierName: "Papy Moto", courierPhone: "0899000111", trackingRef: "MOTO-42" };

async function paidDuo(makeActor: (n?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeur NF");
  const buyer = await makeActor("Acheteur NF");
  const item = await apiListing(seller.request);
  const orderId = await apiBuyAndPay(buyer.request, item.id);
  return { seller, buyer, item, orderId };
}
async function apiCourierOrder(buyer: APIRequestContext, itemId: string): Promise<string> {
  const r = await buyer.post("/api/v1/orders", { data: { itemIds: [itemId], deliveryMethod: "courier", deliveryAreaId: ID.areaLimete, deliveryLandmark: "Avenue de la Paix, portail bleu" } });
  expect(r.status(), `commande : ${await r.text()}`).toBe(201);
  return (await r.json()).order.id;
}
async function courierPaid(makeActor: (n?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeur Coursier NF");
  const buyer = await makeActor("Acheteur Coursier NF");
  const item = await apiListing(seller.request);
  const orderId = await apiCourierOrder(buyer.request, item.id);
  expect((await apiPay(buyer.request, orderId, "0821111111")).status()).toBe(202);
  await waitForStatus(buyer.request, orderId, "paid");
  return { seller, buyer, item, orderId };
}

test.describe("NF Notifications ajoutées", () => {
  test("NF-1 demande d'annulation : pastille chez le vendeur, page, lien vers la commande ; refus : l'acheteur est prévenu et peut ouvrir un litige", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    await open(seller.page, "/");
    await expect(mobileNav(seller).getByRole("link", { name: unread("Profil", 1) })).toBeVisible(); // la vente payée seulement

    expect((await post(buyer, orderId, "cancel-request")).status()).toBe(200);
    await open(seller.page, "/");
    await expect(mobileNav(seller).getByRole("link", { name: unread("Profil", 2) })).toBeVisible();
    await open(seller.page, "/notifications");
    const row = seller.page.getByRole("listitem").filter({ hasText: "Demande d'annulation" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("demande l'annulation de la commande");
    await row.getByRole("link").click();
    await expect(seller.page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    await expect(seller.page.getByRole("heading", { name: "L'acheteur demande l'annulation" })).toBeVisible();
    expect((await feed(seller)).unreadCount).toBe(1); // ouvrir l'objet vaut lecture
    expect(await kindsOf(buyer, "cancel_requested")).toEqual([]); // jamais l'auteur

    // le vendeur refuse : l'acheteur est prévenu, avec un lien vers la commande
    await seller.page.getByRole("button", { name: "Refuser" }).click();
    await expect(seller.page.getByText("Tu as refusé la demande d'annulation")).toBeVisible();
    await open(buyer.page, "/notifications");
    const refused = buyer.page.getByRole("listitem").filter({ hasText: "Annulation refusée" });
    await expect(refused).toHaveCount(1);
    await expect(refused).toContainText("ouvrir un litige");
    await refused.getByRole("link").click();
    await expect(buyer.page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    expect((await kindsOf(seller, "cancel_declined"))).toEqual([]);
  });

  test("NF-2 demande retirée (vendeur prévenu) puis acceptée (acheteur prévenu : annulée et remboursée)", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    expect((await post(buyer, orderId, "cancel-request")).status()).toBe(200);
    expect((await post(buyer, orderId, "cancel-request/withdraw")).status()).toBe(200);
    const withdrawn = await kindsOf(seller, "cancel_withdrawn");
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0].href).toBe(`/orders/${orderId}`);
    expect((await post(buyer, orderId, "cancel-request")).status()).toBe(200);
    expect(await kindsOf(seller, "cancel_requested")).toHaveLength(2);

    expect((await post(seller, orderId, "cancel-request/accept")).status()).toBe(200);
    await open(buyer.page, "/notifications");
    const row = buyer.page.getByRole("listitem").filter({ hasText: "Annulation acceptée" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("tu es remboursé");
    await row.getByRole("link").click();
    await expect(buyer.page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    expect((await kindsOf(seller, "cancel_accepted"))).toEqual([]);
  });

  test("NF-3 livraison par coursier : remis au coursier, en route (acheteur) puis reçu (vendeur)", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await courierPaid(makeActor);
    expect(await kindsOf(buyer, "parcel_handed")).toEqual([]);
    expect((await post(seller, orderId, "ship", MOTO)).status()).toBe(200);
    await open(buyer.page, "/");
    await expect(mobileNav(buyer).getByRole("link", { name: unread("Profil", 1) })).toBeVisible();
    await open(buyer.page, "/notifications");
    const handed = buyer.page.getByRole("listitem").filter({ hasText: "Colis remis au coursier" });
    await expect(handed).toHaveCount(1);
    await expect(handed).toContainText("Suis la livraison");
    await handed.getByRole("link").click();
    await expect(buyer.page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    expect(await kindsOf(seller, "parcel_handed")).toEqual([]);

    expect((await post(seller, orderId, "in-transit")).status()).toBe(200);
    expect(await kindsOf(buyer, "parcel_in_transit")).toHaveLength(1);

    expect((await post(buyer, orderId, "received")).status()).toBe(200);
    await open(seller.page, "/notifications");
    const got = seller.page.getByRole("listitem").filter({ hasText: "Colis reçu" });
    await expect(got).toHaveCount(1);
    await expect(got).toContainText("48 heures");
    await got.getByRole("link").click();
    await expect(seller.page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    expect(await kindsOf(buyer, "parcel_received")).toEqual([]);
  });

  test("NF-4 colis perdu : l'autre partie est prévenue avec un lien vers le litige, jamais l'auteur", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await courierPaid(makeActor);
    expect((await post(seller, orderId, "ship", MOTO)).status()).toBe(200);
    const lost = await post(buyer, orderId, "lost", { description: "Le colis n'est jamais arrivé chez moi." });
    expect(lost.status()).toBe(201);
    const n = await kindsOf(seller, "parcel_lost");
    expect(n).toHaveLength(1);
    expect(n[0].href).toBe(`/orders/${orderId}/dispute`);
    expect(await kindsOf(seller, "dispute_opened")).toEqual([]);
    expect((await feed(buyer)).notifications.filter((x) => x.kind === "parcel_lost" || x.kind === "dispute_opened")).toEqual([]);
    await open(seller.page, "/notifications");
    const row = seller.page.getByRole("listitem").filter({ hasText: "Colis signalé non reçu" });
    await expect(row).toHaveCount(1);
    await row.getByRole("link").click();
    await expect(seller.page).toHaveURL(new RegExp(`/orders/${orderId}/dispute$`));
    // on clôt le litige : la file de l'assistance doit rester propre pour les autres tests
    const disputeId = (await lost.json()).dispute.id as string;
    const staff = await makeActor("Assistance NF", staffPhone());
    expect((await staff.request.post(`/api/v1/staff/disputes/${disputeId}/resolve`, { data: { outcome: "refund_buyer", note: "Colis perdu." } })).status()).toBe(200);
  });

  test("NF-5 photo reçue : regroupée avec les messages de la conversation ; preuve de litige : l'autre partie est prévenue", async ({ makeActor }) => {
    const { seller, buyer, item, orderId } = await paidDuo(makeActor);
    const conv = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    await buyer.request.post(`/api/v1/conversations/${conv}/messages`, { data: { body: "Bonjour, voici la photo demandée" } });
    expect((await buyer.request.post(`/api/v1/conversations/${conv}/messages`, { data: { body: "", photo: PHOTO } })).status()).toBe(201);
    const messages = (await feed(seller)).notifications.filter((n) => n.kind === "message_received");
    expect(messages).toHaveLength(1);
    await open(seller.page, "/notifications");
    await expect(seller.page.getByRole("listitem").filter({ hasText: "Nouveau message de Acheteur NF" }).getByText("2 messages non lus")).toBeVisible();

    const d = await buyer.request.post(`/api/v1/orders/${orderId}/dispute`, { data: { reason: "damaged", description: "L'article est abîmé, voir les photos." } });
    const disputeId = (await d.json()).dispute.id as string;
    expect((await buyer.request.post(`/api/v1/disputes/${disputeId}/evidence`, { data: { photo: PHOTO, note: "Le col est déchiré" } })).status()).toBe(201);
    const ev = await kindsOf(seller, "dispute_evidence");
    expect(ev).toHaveLength(1);
    expect(ev[0].href).toBe(`/orders/${orderId}/dispute`);
    expect(JSON.stringify(ev[0])).not.toContain("col est déchiré");
    expect(await kindsOf(buyer, "dispute_evidence")).toEqual([]);
    const staff = await makeActor("Assistance NF2", staffPhone());
    expect((await staff.request.post(`/api/v1/staff/disputes/${disputeId}/resolve`, { data: { outcome: "refund_buyer", note: "Article abîmé." } })).status()).toBe(200);
  });

  test("NF-6 annonce masquée : son vendeur est prévenu, texte neutre sans détail du signalement ; pas le signaleur", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur Masqué NF");
    const reporter = await makeActor("Signaleur NF");
    const item = await apiListing(seller.request);
    const rep = await reporter.request.post("/api/v1/reports", { data: { targetType: "item", targetId: item.id, reason: "scam", details: "Il demande de payer par un autre moyen, voir 0899123456." } });
    const reportId = (await rep.json()).report.id as string;
    const staff = await makeActor("Modération NF", staffPhone());
    expect((await staff.request.post(`/api/v1/staff/reports/${reportId}`, { data: { action: "hide_item" } })).status()).toBe(200);
    const n = await kindsOf(seller, "listing_hidden");
    expect(n).toHaveLength(1);
    expect(n[0].href).toBe(`/items/${item.id}`);
    expect(`${n[0].title} ${n[0].body}`).not.toMatch(/scam|arnaque|autre moyen|0899/i);
    expect(await kindsOf(reporter, "listing_hidden")).toEqual([]);
    await open(seller.page, "/notifications");
    const row = seller.page.getByRole("listitem").filter({ hasText: "Annonce masquée" });
    await expect(row).toHaveCount(1);
    await row.getByRole("link").click();
    await expect(seller.page).toHaveURL(new RegExp(`/items/${item.id}$`));
  });

  test("NF-7 préférences SMS : la catégorie « Commandes » couvre les nouveaux SMS ; la couper n'enlève pas la notification interne", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    await open(seller.page, "/me/notifications");
    const orders = seller.page.getByRole("switch", { name: "Commandes" });
    await expect(orders).toBeChecked();
    await expect(seller.page.getByText(/qu'un acheteur demande à l'annuler/)).toBeVisible();
    await expect(seller.page.getByText(/remet ton colis au coursier/)).toBeVisible();
    await orders.focus();
    await seller.page.keyboard.press("Space");
    await expect(seller.page.getByRole("status").filter({ hasText: "Préférence enregistrée." })).toBeVisible();
    await expect(orders).not.toBeChecked();
    expect((await (await seller.request.get("/api/v1/notifications/preferences")).json()).preferences).toEqual({ orders: false, disputes: true });
    // la demande d'annulation arrive quand même dans l'application
    expect((await post(buyer, orderId, "cancel-request")).status()).toBe(200);
    expect(await kindsOf(seller, "cancel_requested")).toHaveLength(1);
  });

  test("NF-8 la tâche de rappels est protégée par le secret et renvoie ses compteurs", async ({ makeActor }) => {
    const a = await makeActor("Membre tâche NF");
    expect((await a.request.post("/api/internal/jobs/send_order_reminders")).status()).toBe(401);
    const r = await a.request.post("/api/internal/jobs/send_order_reminders", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(r.status()).toBe(200);
    const res = (await r.json()).result;
    expect(typeof res.cancelExpired).toBe("number");
    expect(typeof res.claimReminders).toBe("number");
  });

  test("NF-9 accessibilité : le centre de notifications avec tous les nouveaux types, sans erreur d'hydratation", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    // vendeur : demande, retrait, nouvelle demande (3 types côté vendeur) ; acheteur : refus
    await post(buyer, orderId, "cancel-request");
    await post(buyer, orderId, "cancel-request/withdraw");
    await post(buyer, orderId, "cancel-request");
    await post(seller, orderId, "cancel-request/decline");
    const c = await courierPaid(makeActor);
    await post(c.seller, c.orderId, "ship", MOTO);
    await post(c.seller, c.orderId, "in-transit");
    await post(c.buyer, c.orderId, "received");
    for (const [label, a] of [["vendeur", seller], ["acheteur", buyer], ["acheteur coursier", c.buyer], ["vendeur coursier", c.seller]] as const) {
      await open(a.page, "/notifications");
      await expect(a.page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
      const issues = (await scan(a.page)).filter((i) => i.impact === "serious" || i.impact === "critical");
      expect(issues, `axe sur /notifications (${label})`).toEqual([]);
    }
    await open(seller.page, "/me/notifications");
    expect((await scan(seller.page)).filter((i) => i.impact === "serious" || i.impact === "critical")).toEqual([]);
    // rechargement direct avec des non lues : la pastille rendue par le serveur est la même que celle du client
    await open(c.buyer.page, "/notifications");
    await c.buyer.page.reload();
    await expect(mobileNav(c.buyer).getByRole("link", { name: unread("Profil", 2) })).toBeVisible();
  });
});
