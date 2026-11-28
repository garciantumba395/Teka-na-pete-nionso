import type { APIRequestContext, Page } from "@playwright/test";
import { ID, alerts, apiListing, expect, money, noHorizontalScroll, open, test, uniqueTitle, waitForStatus, type Actor } from "../support";

// ---- agent J : lots (panier d'un même vendeur)
type MakeActor = (n?: string) => Promise<Actor>;

const addBtn = (p: Page) => p.getByRole("button", { name: "Ajouter au panier" });
const itemStatus = async (r: APIRequestContext, id: string) => (await (await r.get(`/api/v1/items/${id}`)).json()).item.status as string;
const lotOrderBody = (ids: string[]) => ({ itemIds: ids, deliveryMethod: "hand_delivery" });
const addToCart = (r: APIRequestContext, itemId: string) => r.post("/api/v1/cart", { data: { itemId } });

async function trio(makeActor: MakeActor, prices = [4000, 3000, 2000], currency: "USD" | "CDF" = "USD") {
  const seller = await makeActor("Vendeur Lot");
  const buyer = await makeActor("Acheteur Lot");
  const items = [];
  for (const [i, p] of prices.entries()) items.push(await apiListing(seller.request, { priceMinor: p, currency, title: uniqueTitle(`Lot${i}`) }));
  return { seller, buyer, items };
}

test.describe("F12 Lots : panier d'un même vendeur", () => {
  test("J-H1 ajouter 3 articles depuis le profil du vendeur, voir le total, commander, payer, remettre avec le code : les 3 passent « Vendu »", async ({ makeActor }) => {
    const { seller, buyer, items } = await trio(makeActor);
    const p = buyer.page;
    await open(p, `/members/${seller.userId}`);
    for (let n = 1; n <= 3; n++) {
      await addBtn(p).first().click();
      await expect(p.getByRole("link", { name: /Dans ton panier/ })).toHaveCount(n);
    }
    await open(p, "/cart");
    await expect(p.getByTestId("cart-lot")).toHaveCount(1);
    for (const it of items) await expect(p.getByRole("link", { name: it.title })).toBeVisible();
    // 40 $ + 30 $ + 20 $ = 90 $ ; protection 5 % sur le TOTAL = 4,50 $ ; total 94,50 $
    const lot = p.getByTestId("cart-lot");
    await expect(lot.getByText("Sous-total (3 articles)")).toBeVisible();
    expect(money(await lot.locator("dd").nth(0).innerText())).toBe("90 $");
    expect(money(await lot.locator("dd").nth(1).innerText())).toBe("4,50 $");
    expect(money(await lot.locator("dd.total").innerText())).toBe("94,50 $");
    await p.getByRole("button", { name: /^Commander le lot/ }).click();
    await p.getByRole("button", { name: "Confirmer la commande du lot" }).click();
    await expect(p).toHaveURL(/\/orders\/[0-9a-f-]{36}\/pay$/);
    const orderId = p.url().split("/")[4];
    // la page de paiement montre les trois articles et le total du lot
    await expect(p.getByRole("heading", { name: "Ta commande" })).toBeVisible();
    for (const it of items) await expect(p.getByText(it.title)).toBeVisible();
    expect(money(await p.locator("dd.total").innerText())).toBe("94,50 $");
    for (const it of items) expect(await itemStatus(buyer.request, it.id)).toBe("reserved");
    // le panier ne garde plus ces articles
    await open(p, "/cart");
    await expect(p.getByText("Ton panier est vide")).toBeVisible();
    // paiement
    await open(p, `/orders/${orderId}/pay`);
    await p.getByRole("button", { name: /^Payer/ }).click();
    await expect(p.getByText("Paiement reçu").first()).toBeVisible({ timeout: 20_000 });
    // la page de la commande liste les trois articles
    await expect(p.getByRole("heading", { name: "Détail du lot (3 articles)" })).toBeVisible();
    await p.getByRole("button", { name: "Afficher mon code" }).click();
    const label = await p.getByRole("img", { name: /Code de remise/ }).getAttribute("aria-label");
    const code = label!.replace(/\D/g, "");
    expect(code).toMatch(/^\d{6}$/);
    await open(seller.page, `/orders/${orderId}`);
    await seller.page.locator(".otp input").first().click();
    await seller.page.keyboard.type(code, { delay: 30 });
    await expect(seller.page.getByText("Vente terminée")).toBeVisible({ timeout: 15_000 });
    for (const it of items) expect(await itemStatus(buyer.request, it.id)).toBe("sold");
    await open(seller.page, "/wallet");
    expect(money(await seller.page.getByTestId("balance-USD").innerText())).toBe("90 $");
    // une seule commande côté acheteur
    expect((await (await buyer.request.get("/api/v1/me/orders")).json()).orders).toHaveLength(1);
  });

  test("J-H2 depuis la fiche annonce : ajouter au panier, « Dans ton panier », panier vide à l'origine", async ({ makeActor }) => {
    const { buyer, items } = await trio(makeActor, [2500, 2500]);
    const p = buyer.page;
    await open(p, "/cart");
    await expect(p.getByText("Ton panier est vide")).toBeVisible();
    await open(p, `/items/${items[0].id}`);
    await addBtn(p).click();
    await expect(p.getByRole("link", { name: /Dans ton panier/ })).toBeVisible();
    await p.reload();
    await expect(p.getByRole("link", { name: /Dans ton panier/ })).toBeVisible(); // état retenu par le serveur
    await open(p, "/cart");
    await expect(p.getByRole("link", { name: items[0].title })).toBeVisible();
    await p.getByRole("button", { name: `Retirer ${items[0].title} du panier` }).click();
    await expect(p.getByText("Ton panier est vide")).toBeVisible();
  });

  test("J-E1 deux devises : le panier fait deux lots, le serveur refuse un lot mixte avec un 422 clair", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur Devises");
    const buyer = await makeActor("Acheteur Devises");
    const usd = await apiListing(seller.request, { priceMinor: 2500 });
    const cdf = await apiListing(seller.request, { priceMinor: 3_500_000, currency: "CDF" });
    expect((await addToCart(buyer.request, usd.id)).status()).toBe(201);
    expect((await addToCart(buyer.request, cdf.id)).status()).toBe(201);
    await open(buyer.page, "/cart");
    await expect(buyer.page.getByTestId("cart-lot")).toHaveCount(2);
    await expect(buyer.page.getByText("Ce vendeur a des articles dans deux devises").first()).toBeVisible();
    const r = await buyer.request.post("/api/v1/orders", { data: lotOrderBody([usd.id, cdf.id]) });
    expect(r.status()).toBe(422);
    const err = (await r.json()).error;
    expect(err.code).toBe("MIXED_CURRENCY");
    expect(err.message).toBe("Choisis des articles dans la même devise.");
    expect(await itemStatus(buyer.request, usd.id)).toBe("active");
    expect(await itemStatus(buyer.request, cdf.id)).toBe("active");
    // chaque lot se commande séparément
    await buyer.page.getByTestId("cart-lot").filter({ hasText: "dollars" }).getByRole("button", { name: /^Commander le lot/ }).click();
    await buyer.page.getByRole("button", { name: "Confirmer la commande du lot" }).click();
    await expect(buyer.page).toHaveURL(/\/pay$/);
    await open(buyer.page, "/cart");
    await expect(buyer.page.getByTestId("cart-lot")).toHaveCount(1);
    await expect(buyer.page.getByTestId("cart-lot")).toContainText("francs congolais");
  });

  test("J-E2 un article devient indisponible entre l'ajout et la commande : signalé, bouton bloqué ; commande refusée en entier si la page était périmée", async ({ makeActor }) => {
    const { buyer, items } = await trio(makeActor, [2000, 2000, 2000]);
    const rival = await makeActor("Acheteur Rival");
    const [a, b, c] = items;
    for (const it of items) expect((await addToCart(buyer.request, it.id)).status()).toBe(201);
    const p = buyer.page;
    await open(p, "/cart");
    await p.getByRole("button", { name: /^Commander le lot/ }).click(); // la page est chargée : tout semble disponible
    // un autre acheteur réserve le deuxième article pendant ce temps
    const rr = await rival.request.post("/api/v1/orders", { data: lotOrderBody([b.id]) });
    expect(rr.status()).toBe(201);
    await p.getByRole("button", { name: "Confirmer la commande du lot" }).click();
    const alert = alerts(p).filter({ hasText: b.title });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Retire-le du lot");
    expect(await itemStatus(buyer.request, a.id)).toBe("active");
    expect(await itemStatus(buyer.request, c.id)).toBe("active"); // rien n'a été réservé
    expect((await (await buyer.request.get("/api/v1/me/orders")).json()).orders).toHaveLength(0);
    // la page se met à jour : l'article est signalé, la commande du lot est bloquée
    await expect(p.getByText("Un autre acheteur est en train de le payer.")).toBeVisible();
    await expect(p.getByRole("button", { name: /^Commander le lot/ })).toBeDisabled();
    await p.getByRole("button", { name: "Retirer l'article indisponible" }).click();
    await expect(p.getByText("Un autre acheteur est en train de le payer.")).toHaveCount(0);
    await expect(p.getByText("Sous-total (2 articles)")).toBeVisible();
    await expect(p.getByRole("button", { name: "Confirmer la commande du lot" })).toBeEnabled(); // le choix de livraison reste ouvert
    await p.getByRole("button", { name: "Confirmer la commande du lot" }).click();
    await expect(p).toHaveURL(/\/pay$/);
    expect(await itemStatus(buyer.request, a.id)).toBe("reserved");
    expect(await itemStatus(buyer.request, c.id)).toBe("reserved");
  });

  test("J-E3 deux acheteurs visent le même lot, plusieurs fois de suite : un seul gagne, l'autre ne garde aucun article", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur Course");
    const a = await makeActor("Acheteur Course A");
    const b = await makeActor("Acheteur Course B");
    for (let round = 0; round < 6; round++) {
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) ids.push((await apiListing(seller.request, { priceMinor: 1500 })).id);
      const [ra, rb] = await Promise.all([
        a.request.post("/api/v1/orders", { data: lotOrderBody(ids) }),
        b.request.post("/api/v1/orders", { data: lotOrderBody([...ids].reverse()) }),
      ]);
      const codes = [ra.status(), rb.status()].sort();
      expect(codes, `tour ${round}`).toEqual([201, 409]);
      const loser = ra.status() === 409 ? ra : rb;
      expect((await loser.json()).error.code).toBe("ITEM_UNAVAILABLE");
      const winner = ra.status() === 201 ? a : b;
      const loserActor = winner === a ? b : a;
      expect((await (await loserActor.request.get("/api/v1/me/orders")).json()).orders.filter((o: { items: { id: string }[] }) => o.items.some((x) => ids.includes(x.id)))).toHaveLength(0);
      for (const id of ids) expect(await itemStatus(a.request, id)).toBe("reserved");
      // le gagnant annule : tous les articles reviennent ensemble
      const orderId = (await (await winner.request.get("/api/v1/me/orders")).json()).orders.find((o: { items: { id: string }[] }) => o.items.some((x) => x.id === ids[0])).id;
      expect((await winner.request.post(`/api/v1/orders/${orderId}/cancel`, { data: {} })).status()).toBe(200);
      for (const id of ids) expect(await itemStatus(a.request, id)).toBe("active");
    }
  });

  test("J-E4 règles du panier côté serveur : son propre article, doublon, vendu, plafond de 20, non connecté", async ({ makeActor, request }) => {
    const seller = await makeActor("Vendeur Règles");
    const buyer = await makeActor("Acheteur Règles");
    const own = await apiListing(buyer.request);
    const one = await apiListing(seller.request);
    const sold = await apiListing(seller.request);
    expect((await addToCart(buyer.request, own.id)).status()).toBe(409);
    expect((await (await addToCart(buyer.request, own.id)).json()).error.code).toBe("SELF_PURCHASE");
    expect((await addToCart(buyer.request, one.id)).status()).toBe(201);
    const dup = await addToCart(buyer.request, one.id);
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.code).toBe("ALREADY_IN_CART");
    // article vendu
    const other = await makeActor("Acheteur Vendu");
    const oid = (await (await other.request.post("/api/v1/orders", { data: lotOrderBody([sold.id]) })).json()).order.id;
    expect((await other.request.post(`/api/v1/orders/${oid}/pay`, { data: { method: "mpesa", msisdn: "0821111111", idempotencyKey: crypto.randomUUID() } })).status()).toBe(202);
    await waitForStatus(other.request, oid, "paid");
    const code = (await (await other.request.get(`/api/v1/orders/${oid}/handover-code`)).json()).code;
    expect((await seller.request.post(`/api/v1/orders/${oid}/confirm-delivery`, { data: { code } })).status()).toBe(200);
    const s = await addToCart(buyer.request, sold.id);
    expect(s.status()).toBe(409);
    expect((await s.json()).error.code).toBe("ITEM_UNAVAILABLE");
    // plafond : 20 articles au plus (1 déjà dans le panier)
    for (let i = 0; i < 19; i++) expect((await addToCart(buyer.request, (await apiListing(seller.request, { priceMinor: 500 })).id)).status()).toBe(201);
    const full = await addToCart(buyer.request, (await apiListing(seller.request, { priceMinor: 500 })).id);
    expect(full.status()).toBe(409);
    expect((await full.json()).error.code).toBe("CART_FULL");
    expect((await (await buyer.request.get("/api/v1/cart")).json()).cart.count).toBe(20);
    // un lot de plus de 20 articles est refusé dès la validation de la commande
    const many = (await (await buyer.request.get("/api/v1/cart")).json()).cart.lots[0].orderableItemIds as string[];
    const r21 = await buyer.request.post("/api/v1/orders", { data: lotOrderBody([...many, one.id, sold.id]) });
    expect(r21.status()).toBe(422);
    // non connecté
    expect((await request.get("/api/v1/cart")).status()).toBe(401);
    expect((await request.post("/api/v1/cart", { data: { itemId: one.id } })).status()).toBe(401);
    // un membre ne voit pas le panier d'un autre
    expect((await (await seller.request.get("/api/v1/cart")).json()).cart.count).toBe(0);
    // retirer est idempotent
    expect((await buyer.request.post("/api/v1/cart/remove", { data: { itemId: one.id } })).status()).toBe(200);
    expect((await buyer.request.post("/api/v1/cart/remove", { data: { itemId: one.id } })).status()).toBe(200);
  });

  test("J-E5 plafond de valeur par commande appliqué au total du lot (3 x 400 $ refusés, 2 x 400 $ acceptés)", async ({ makeActor }) => {
    const { buyer, items } = await trio(makeActor, [40_000, 40_000, 40_000]);
    for (const it of items) await addToCart(buyer.request, it.id);
    await open(buyer.page, "/cart");
    await expect(buyer.page.getByText(/dépasse la valeur maximale/).first()).toBeVisible();
    await expect(buyer.page.getByRole("button", { name: /^Commander le lot/ })).toBeDisabled();
    const r = await buyer.request.post("/api/v1/orders", { data: lotOrderBody(items.map((i) => i.id)) });
    expect(r.status()).toBe(422);
    expect((await r.json()).error.code).toBe("ORDER_TOO_LARGE");
    for (const it of items) expect(await itemStatus(buyer.request, it.id)).toBe("active");
    await buyer.page.getByRole("button", { name: `Retirer ${items[2].title} du panier` }).click();
    await expect(buyer.page.getByRole("button", { name: /^Commander le lot/ })).toBeEnabled();
  });

  test("J-E6 livraison par coursier pour un lot : frais calculés une seule fois (4 $ pour 3 articles)", async ({ makeActor }) => {
    const { seller, buyer, items } = await trio(makeActor, [3000, 3000, 3000]);
    for (const it of items) await addToCart(buyer.request, it.id);
    const p = buyer.page;
    await open(p, "/cart");
    await p.getByRole("button", { name: /^Commander le lot/ }).click();
    await p.getByRole("radio", { name: /Livraison par coursier/ }).check();
    await p.getByLabel("Ta commune").selectOption(ID.areaLimete);
    await p.getByLabel("Repère pour le coursier").fill("Avenue de la Paix, portail bleu");
    // 90 $ + 4,50 $ de protection + 4 $ de livraison (une seule fois)
    await expect(p.getByRole("status").filter({ hasText: "Livraison :" })).toContainText("4 $");
    await expect(p.getByRole("status").filter({ hasText: "Livraison :" })).toContainText("98,50 $");
    await p.getByRole("button", { name: "Confirmer la commande du lot" }).click();
    await expect(p).toHaveURL(/\/pay$/);
    const orderId = p.url().split("/")[4];
    expect(money(await p.locator("dd.total").innerText())).toBe("98,50 $");
    const order = (await (await buyer.request.get(`/api/v1/orders/${orderId}`)).json()).order;
    expect(order.shippingMinor).toBe(400);
    expect(order.items).toHaveLength(3);
    await p.getByRole("button", { name: /^Payer/ }).click();
    await expect(p.getByText("Paiement reçu").first()).toBeVisible({ timeout: 20_000 });
    // le vendeur voit un seul formulaire de coursier pour le lot
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByRole("heading", { name: "Détail du lot (3 articles)" })).toBeVisible();
    await expect(seller.page.getByLabel("Nom du coursier")).toHaveCount(1);
  });

  test("J-A1 visiteur non connecté : « Ajouter au panier » renvoie vers la connexion ; /cart aussi", async ({ makeActor, page }) => {
    const seller = await makeActor("Vendeur Visiteur");
    const item = await apiListing(seller.request);
    await open(page, `/items/${item.id}`);
    await addBtn(page).click();
    await expect(page).toHaveURL(/\/signin/);
    await open(page, "/cart");
    await expect(page).toHaveURL(/\/signin\?next=(%2F|\/)cart/);
  });

  test("J-A2 largeur 320 px : pas de défilement horizontal (fiche, profil, panier, panier avec articles indisponibles)", async ({ makeActor }) => {
    const { seller, buyer, items } = await trio(makeActor, [2500, 2500]);
    const p = buyer.page;
    await p.setViewportSize({ width: 320, height: 640 });
    await open(p, `/items/${items[0].id}`);
    expect(await noHorizontalScroll(p)).toBe(true);
    // les trois actions sont visibles et tiennent dans l'écran
    for (const name of [/^Acheter/, "Écrire", "Ajouter au panier"]) {
      const box = await p.getByRole("button", { name }).boundingBox();
      expect(box, String(name)).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
    await open(p, `/members/${seller.userId}`);
    expect(await noHorizontalScroll(p)).toBe(true);
    await open(p, "/cart");
    expect(await noHorizontalScroll(p)).toBe(true);
    for (const it of items) await addToCart(buyer.request, it.id);
    const rival = await makeActor("Rival 320");
    await rival.request.post("/api/v1/orders", { data: lotOrderBody([items[1].id]) });
    await open(p, "/cart");
    await expect(p.getByText("Un autre acheteur est en train de le payer.")).toBeVisible();
    expect(await noHorizontalScroll(p)).toBe(true);
    await p.getByRole("button", { name: /^Commander le lot|Retirer l'article indisponible/ }).first().scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(p)).toBe(true);
  });
});
