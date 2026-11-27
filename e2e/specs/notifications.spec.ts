import { apiBuyAndPay, apiCode, apiListing, expect, open, staffPhone, test, type Actor } from "../support";

// Notifications internes : message, commande payée, litige, préférences, isolation. Chaque test échoue sur erreur console
// (dont une éventuelle erreur d'hydratation de la pastille) ou réponse 5xx.

interface Row { id: string; kind: string; title: string; body: string; href: string | null; read: boolean }
const feed = async (a: Actor): Promise<{ unreadCount: number; notifications: Row[] }> => {
  const r = await a.request.get("/api/v1/notifications");
  expect(r.status()).toBe(200);
  return r.json();
};
const mobileNav = (a: Actor) => a.page.getByRole("navigation", { name: "Navigation principale (mobile)" });
/** Nom accessible d'un lien de navigation avec pastille : « Profil, 2 notifications non lues » (un espace peut s'intercaler selon la mise en page). */
const unread = (label: string, n: number) => new RegExp(`^${label} ?, ${n} notifications? non lues?$`);
const profileTab =(a: Actor, name: string | RegExp) => mobileNav(a).getByRole("link", { name });

async function duo(makeActor: (n?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeuse Notif");
  const buyer = await makeActor("Acheteur Notif");
  const item = await apiListing(seller.request);
  return { seller, buyer, item };
}

test.describe("N Notifications", () => {
  test("N-1 message reçu : pastille, page, lecture en ouvrant la conversation, regroupement", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    await open(seller.page, "/");
    await expect(profileTab(seller, "Profil")).toBeVisible(); // aucune pastille au départ
    const conv = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    for (const body of ["Bonjour, disponible ?", "Je peux passer demain."]) {
      expect((await buyer.request.post(`/api/v1/conversations/${conv}/messages`, { data: { body } })).status()).toBe(201);
    }

    await open(seller.page, "/");
    await expect(profileTab(seller, unread("Profil", 1))).toBeVisible(); // une seule, malgré deux messages
    await open(seller.page, "/notifications");
    await expect(seller.page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    const row = seller.page.getByRole("listitem").filter({ hasText: "Nouveau message de Acheteur Notif" });
    await expect(row).toHaveCount(1);
    await expect(row.getByText("2 messages non lus")).toBeVisible();
    await expect(row.getByText("Nouveau", { exact: true })).toBeVisible();

    // ouvrir la notification mène à la conversation et la marque comme lue
    await row.getByRole("link").click();
    await expect(seller.page).toHaveURL(new RegExp(`/inbox/${conv}$`));
    await open(seller.page, "/");
    await expect(profileTab(seller, "Profil")).toBeVisible();
    const after = await feed(seller);
    expect(after.unreadCount).toBe(0);
    expect(after.notifications[0].read).toBe(true);

    // l'acheteur n'est jamais prévenu de ses propres messages
    expect((await feed(buyer)).notifications).toEqual([]);
    // un nouveau message, après lecture, crée une nouvelle notification
    await buyer.request.post(`/api/v1/conversations/${conv}/messages`, { data: { body: "Toujours là ?" } });
    expect((await feed(seller)).unreadCount).toBe(1);
  });

  test("N-2 commande payée : le vendeur est prévenu et le lien mène à la commande ; l'acheteur non", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    await open(seller.page, "/notifications");
    const row = seller.page.getByRole("listitem").filter({ hasText: "Commande payée" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Organise la remise");
    await row.getByRole("link").click();
    await expect(seller.page).toHaveURL(new RegExp(`/orders/${orderId}$`));
    expect((await feed(seller)).unreadCount).toBe(0); // ouvrir l'objet vaut lecture
    expect((await feed(buyer)).notifications.filter((n) => n.kind === "order_paid")).toEqual([]);

    // remise par le code : l'acheteur est prévenu, pas le vendeur qui a agi
    const r = await seller.request.post(`/api/v1/orders/${orderId}/confirm-delivery`, { data: { code: await apiCode(buyer.request, orderId) } });
    expect(r.status()).toBe(200);
    expect((await feed(buyer)).notifications.map((n) => n.title)).toEqual(["Remise confirmée"]);
    expect((await feed(seller)).notifications.map((n) => n.kind)).toEqual(["order_paid"]);
  });

  test("N-3 litige : ouvert (autre partie), message, résolu (les deux parties)", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    const d = await buyer.request.post(`/api/v1/orders/${orderId}/dispute`, { data: { reason: "not_received", description: "Le vendeur ne s'est pas présenté." } });
    expect(d.status()).toBe(201);
    const disputeId = (await d.json()).dispute.id;

    const opened = (await feed(seller)).notifications.find((n) => n.kind === "dispute_opened");
    expect(opened?.href).toBe(`/orders/${orderId}/dispute`);
    expect((await feed(buyer)).notifications).toEqual([]);

    await seller.request.post(`/api/v1/disputes/${disputeId}/notes`, { data: { note: "J'étais au rendez-vous." } });
    expect((await feed(buyer)).notifications.map((n) => n.kind)).toEqual(["dispute_message"]);

    const staff = await makeActor("Assistance", staffPhone());
    const res = await staff.request.post(`/api/v1/staff/disputes/${disputeId}/resolve`, { data: { outcome: "refund_buyer", note: "Remboursement." } });
    expect(res.status()).toBe(200);
    for (const a of [buyer, seller]) {
      expect((await feed(a)).notifications.filter((n) => n.kind === "dispute_resolved")).toHaveLength(1);
    }
    expect((await feed(staff)).notifications).toEqual([]);

    await open(buyer.page, "/notifications");
    await expect(buyer.page.getByRole("listitem").filter({ hasText: "Litige résolu" })).toContainText("l'acheteur est remboursé");
  });

  test("N-4 tout marquer comme lu : la pastille disparaît, le bouton s'éteint", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const item2 = await apiListing(seller.request);
    for (const it of [item, item2]) {
      const c = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: it.id } })).json()).conversation.id;
      await buyer.request.post(`/api/v1/conversations/${c}/messages`, { data: { body: "Question" } });
    }
    await open(seller.page, "/notifications");
    await expect(seller.page.getByText("2 non lues")).toBeVisible();
    await expect(profileTab(seller, unread("Profil", 2))).toBeVisible();
    // une seule, d'abord, via son bouton
    await seller.page.getByRole("button", { name: /^Marquer comme lue : / }).first().click();
    await expect(seller.page.getByText("1 non lue", { exact: true })).toBeVisible();
    await expect(seller.page.getByRole("status").filter({ hasText: "Notification marquée comme lue." })).toBeAttached();
    // puis toutes
    await seller.page.getByRole("button", { name: "Tout marquer comme lu" }).click();
    await expect(seller.page.getByText("Tout est lu")).toBeVisible();
    await expect(seller.page.getByRole("button", { name: "Tout marquer comme lu" })).toBeDisabled();
    await expect(profileTab(seller, "Profil")).toBeVisible();
    expect((await feed(seller)).unreadCount).toBe(0);
  });

  test("N-5 liste vide : invitation claire, accès aux réglages SMS", async ({ makeActor }) => {
    const a = await makeActor("Membre calme");
    await open(a.page, "/notifications");
    await expect(a.page.getByText("Aucune notification")).toBeVisible();
    await a.page.getByRole("link", { name: "Régler les SMS" }).click();
    await expect(a.page).toHaveURL(/\/me\/notifications$/);
  });

  test("N-6 préférences : SMS par catégorie, au clavier, conservées au rechargement ; l'interne ne se coupe pas", async ({ makeActor }) => {
    const a = await makeActor("Membre réglages");
    await open(a.page, "/me");
    await a.page.getByRole("link", { name: /Notifications/ }).click();
    await expect(a.page).toHaveURL(/\/notifications$/);
    await open(a.page, "/me/notifications");
    const orders = a.page.getByRole("switch", { name: "Commandes" });
    const disputes = a.page.getByRole("switch", { name: "Litiges" });
    await expect(orders).toBeChecked();
    await expect(disputes).toBeChecked();
    await expect(a.page.getByText(/restent toujours actives/)).toBeVisible();

    await orders.focus();
    await a.page.keyboard.press("Space");
    await expect(a.page.getByRole("status").filter({ hasText: "Préférence enregistrée." })).toBeVisible();
    await expect(orders).not.toBeChecked();
    await expect(orders).toBeFocused(); // le focus ne se perd pas
    expect((await (await a.request.get("/api/v1/notifications/preferences")).json()).preferences).toEqual({ orders: false, disputes: true });

    await open(a.page, "/me/notifications");
    await expect(a.page.getByRole("switch", { name: "Commandes" })).not.toBeChecked();
    await expect(a.page.getByRole("switch", { name: "Litiges" })).toBeChecked();
    await a.page.getByRole("switch", { name: "Commandes" }).check();
    await expect(a.page.getByRole("switch", { name: "Commandes" })).toBeChecked();

    // les notifications internes ne sont pas réglables : l'API refuse toute autre clé
    const bad = await a.request.patch("/api/v1/notifications/preferences", { data: { internal: false } });
    expect(bad.status()).toBe(422);
    const bad2 = await a.request.patch("/api/v1/notifications/preferences", { data: { orders: "oui" } });
    expect(bad2.status()).toBe(422);
  });

  test("N-7 isolation : un tiers ne voit ni ne lit les notifications d'un autre ; non connecté : 401", async ({ makeActor, playwright, baseURL }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const c = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    await buyer.request.post(`/api/v1/conversations/${c}/messages`, { data: { body: "Bonjour" } });
    const mine = (await feed(seller)).notifications[0];
    const tiers = await makeActor("Tiers curieux");
    expect((await feed(tiers)).notifications).toEqual([]);
    expect((await tiers.request.post(`/api/v1/notifications/${mine.id}/read`)).status()).toBe(404);
    expect((await buyer.request.post(`/api/v1/notifications/${mine.id}/read`)).status()).toBe(404);
    expect((await tiers.request.post("/api/v1/notifications/pas-un-uuid/read")).status()).toBe(404);
    expect((await tiers.request.post("/api/v1/notifications/read-all")).status()).toBe(200);
    expect((await feed(seller)).unreadCount).toBe(1); // intacte
    const anon = await playwright.request.newContext({ baseURL: baseURL ?? undefined });
    expect((await anon.get("/api/v1/notifications")).status()).toBe(401);
    expect((await anon.post(`/api/v1/notifications/${mine.id}/read`)).status()).toBe(401);
    expect((await anon.get("/api/v1/notifications/preferences")).status()).toBe(401);
    await anon.dispose();
    // la page redirige vers la connexion
    const ctx = await playwright.request.newContext({ baseURL: baseURL ?? undefined, maxRedirects: 0 });
    expect((await ctx.get("/notifications")).status()).toBe(307);
    await ctx.dispose();
  });

  test("N-8 limite de débit des lectures : 429 au-delà de 120 par minute", async ({ makeActor }) => {
    const a = await makeActor("Membre pressé");
    const codes: number[] = [];
    for (let i = 0; i < 124; i++) codes.push((await a.request.get("/api/v1/notifications")).status());
    expect(codes.filter((c) => c === 200)).toHaveLength(120);
    expect(codes.filter((c) => c === 429)).toHaveLength(4);
  });

  test("N-9 pastille sans erreur d'hydratation : plusieurs écrans avec des non lues, rechargement direct", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const c = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    await buyer.request.post(`/api/v1/conversations/${c}/messages`, { data: { body: "Bonjour" } });
    // le garde du test échoue sur toute erreur console, dont « Hydration failed » / « text content does not match »
    for (const url of ["/", "/search", "/me", "/notifications", "/inbox", `/items/${item.id}`, "/me/notifications"]) {
      await open(seller.page, url);
      await expect(profileTab(seller, unread("Profil", 1))).toBeVisible();
    }
    const html = await (await seller.request.get("/")).text();
    expect(html).toContain("1 notification non lue"); // le compteur est dans le HTML rendu par le serveur
  });
});
