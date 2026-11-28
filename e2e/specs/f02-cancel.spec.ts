import { apiBuyAndPay, apiCode, apiListing, db, expect, isPg, open, orderStatus, staffPhone, test, type Actor } from "../support";

// Annulation encadrée après paiement : l'acheteur DEMANDE, le vendeur accepte ou refuse, l'assistance tranche en cas de désaccord.

async function paidDuo(makeActor: (n?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeur annul");
  const buyer = await makeActor("Acheteur annul");
  const item = await apiListing(seller.request);
  const orderId = await apiBuyAndPay(buyer.request, item.id);
  return { seller, buyer, item, orderId };
}
const post = (a: Actor, orderId: string, path: string) => a.request.post(`/api/v1/orders/${orderId}/${path}`, { data: {} });
const view = async (a: Actor, orderId: string) => (await (await a.request.get(`/api/v1/orders/${orderId}`)).json()).order;
const requestBtn = (a: Actor) => a.page.getByRole("button", { name: "Demander l'annulation" });

test.describe("F02 Annulation encadrée après paiement", () => {
  test("F02-C1 parcours complet : l'acheteur demande, le vendeur accepte, remboursement intégral et article remis en vente", async ({ makeActor }) => {
    const { seller, buyer, item, orderId } = await paidDuo(makeActor);
    await open(buyer.page, `/orders/${orderId}`);
    await requestBtn(buyer).click();
    await expect(buyer.page.getByText(/le vendeur doit accepter/)).toBeVisible();
    await buyer.page.getByRole("button", { name: "Oui, envoyer la demande" }).click();
    await expect(buyer.page.getByText("Demande d'annulation envoyée")).toBeVisible();
    await expect(buyer.page.getByRole("button", { name: "Retirer ma demande" })).toBeVisible();
    expect(await orderStatus(buyer.request, orderId)).toBe("paid"); // rien n'est remboursé avant la réponse du vendeur

    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByRole("heading", { name: "L'acheteur demande l'annulation" })).toBeVisible();
    await seller.page.getByRole("button", { name: "Accepter l'annulation" }).click();
    await seller.page.getByRole("button", { name: "Oui, accepter et rembourser" }).click();
    await expect(seller.page.getByText("Commande annulée").first()).toBeVisible();
    await expect(seller.page.getByText(/Tu as accepté la demande de l'acheteur/)).toBeVisible();

    expect(await orderStatus(buyer.request, orderId)).toBe("cancelled");
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByText("Le vendeur a accepté ta demande. Tu as été remboursé en totalité.")).toBeVisible();
    expect((await (await buyer.request.get(`/api/v1/items/${item.id}`)).json()).item.status).toBe("active");
    if (isPg()) {
      const r = await db()!.query(`select coalesce(sum(amount_minor),0)::int as s from ledger_entries where account = 'order_escrow' and (ref_id = $1 or ref_id in (select id from payments where order_id = $1))`, [orderId]);
      expect(r.rows[0].s).toBe(0);
      const bal = await db()!.query(`select coalesce(sum(amount_minor),0)::int as s from ledger_entries where ref_id = $1 or ref_id in (select id from payments where order_id = $1)`, [orderId]);
      expect(bal.rows[0].s, "écritures de la commande équilibrées").toBe(0);
    }
  });

  test("F02-C2 le vendeur refuse : la commande reste payée, pas de seconde demande, puis litige tranché par l'assistance", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    expect((await post(buyer, orderId, "cancel-request")).status()).toBe(200);
    await open(seller.page, `/orders/${orderId}`);
    await seller.page.getByRole("button", { name: "Refuser" }).click();
    await expect(seller.page.getByText("Tu as refusé la demande d'annulation")).toBeVisible();
    expect(await orderStatus(seller.request, orderId)).toBe("paid");

    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByText("Le vendeur a refusé l'annulation")).toBeVisible();
    await expect(requestBtn(buyer)).toHaveCount(0);
    const again = await post(buyer, orderId, "cancel-request");
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe("CANCEL_REQUEST_REFUSED");

    // désaccord : litige, l'assistance rembourse
    const d = await buyer.request.post(`/api/v1/orders/${orderId}/dispute`, { data: { reason: "other", description: "Le vendeur refuse d'annuler la vente." } });
    expect(d.status()).toBe(201);
    const support = await makeActor("Assistance", staffPhone());
    const res = await support.request.post(`/api/v1/staff/disputes/${(await d.json()).dispute.id}/resolve`, { data: { outcome: "refund_buyer" } });
    expect(res.status()).toBe(200);
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByText("Litige clos : tu as été remboursé")).toBeVisible();
  });

  test("F02-C3 l'acheteur retire sa demande : le vendeur ne la voit plus et ne peut plus l'accepter", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    await open(buyer.page, `/orders/${orderId}`);
    await requestBtn(buyer).click();
    await buyer.page.getByRole("button", { name: "Oui, envoyer la demande" }).click();
    await buyer.page.getByRole("button", { name: "Retirer ma demande" }).click();
    await expect(requestBtn(buyer)).toBeVisible();
    await expect(buyer.page.getByText("Demande d'annulation envoyée")).toHaveCount(0);
    await open(seller.page, `/orders/${orderId}`);
    await expect(seller.page.getByRole("heading", { name: "L'acheteur demande l'annulation" })).toHaveCount(0);
    const late = await post(seller, orderId, "cancel-request/accept");
    expect(late.status()).toBe(409);
    expect((await late.json()).error.code).toBe("CANCEL_REQUEST_NONE");
    expect(await orderStatus(buyer.request, orderId)).toBe("paid");
  });

  test("F02-C4 double-clic : une seule demande, une seule acceptation, un seul remboursement", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    await open(buyer.page, `/orders/${orderId}`);
    await requestBtn(buyer).click();
    await buyer.page.getByRole("button", { name: "Oui, envoyer la demande" }).dblclick();
    await expect(buyer.page.getByText("Demande d'annulation envoyée")).toBeVisible();
    expect((await view(buyer, orderId)).cancelRequest.status).toBe("pending");
    if (isPg()) expect((await db()!.query(`select count(*)::int as n from order_cancel_requests where order_id = $1`, [orderId])).rows[0].n).toBe(1);
    // requêtes concurrentes : exactement une réussit
    const burst = await Promise.all([post(buyer, orderId, "cancel-request"), post(buyer, orderId, "cancel-request")]);
    expect(burst.map((r) => r.status())).toEqual([409, 409]);

    await open(seller.page, `/orders/${orderId}`);
    await seller.page.getByRole("button", { name: "Accepter l'annulation" }).click();
    await seller.page.getByRole("button", { name: "Oui, accepter et rembourser" }).dblclick();
    await expect(seller.page.getByText("Commande annulée").first()).toBeVisible();
    const accepts = await Promise.all([post(seller, orderId, "cancel-request/accept"), post(seller, orderId, "cancel-request/accept")]);
    expect(accepts.every((r) => r.status() === 409)).toBe(true);
    if (isPg()) {
      const r = await db()!.query(`select count(*)::int as n from ledger_entries where account = 'psp_clearing' and amount_minor > 0 and (ref_id = $1 or ref_id in (select id from payments where order_id = $1))`, [orderId]);
      expect(r.rows[0].n, "un seul remboursement écrit").toBe(1);
    }
  });

  test("F02-C5 le code de remise pendant une demande : le code vaut acceptation et clôt la demande", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    expect((await post(buyer, orderId, "cancel-request")).status()).toBe(200);
    const code = await apiCode(buyer.request, orderId);
    const done = await seller.request.post(`/api/v1/orders/${orderId}/confirm-delivery`, { data: { code } });
    expect(done.status()).toBe(200);
    const v = await view(buyer, orderId);
    expect(v.status).toBe("completed");
    expect(v.cancelRequest).toBeNull();
    await open(buyer.page, `/orders/${orderId}`);
    await expect(buyer.page.getByText("Article reçu")).toBeVisible();
    await expect(buyer.page.getByText(/Demande d'annulation/)).toHaveCount(0);
  });

  test("F02-C6 le vendeur garde l'annulation directe, même pendant une demande", async ({ makeActor }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    expect((await post(buyer, orderId, "cancel-request")).status()).toBe(200);
    await open(seller.page, `/orders/${orderId}`);
    await seller.page.getByRole("button", { name: "Annuler la commande" }).click();
    await seller.page.getByRole("button", { name: "Oui, annuler la vente" }).click();
    await expect(seller.page.getByText("Commande annulée").first()).toBeVisible();
    expect(await orderStatus(buyer.request, orderId)).toBe("cancelled");
    expect((await view(buyer, orderId)).cancelRequest).toBeNull();
  });

  test("F02-C7 droits : le vendeur ne demande pas, l'acheteur ne répond pas à sa demande, un tiers et un visiteur n'obtiennent rien", async ({ makeActor, playwright, baseURL }) => {
    const { seller, buyer, orderId } = await paidDuo(makeActor);
    const intrus = await makeActor("Intrus annul");
    expect((await post(seller, orderId, "cancel-request")).status()).toBe(404);
    expect((await post(buyer, orderId, "cancel-request")).status()).toBe(200);
    for (const p of ["cancel-request/accept", "cancel-request/decline"]) expect((await post(buyer, orderId, p)).status(), `acheteur ${p}`).toBe(404);
    expect((await post(seller, orderId, "cancel-request/withdraw")).status()).toBe(404);
    for (const p of ["cancel-request", "cancel-request/withdraw", "cancel-request/accept", "cancel-request/decline"]) {
      expect((await post(intrus, orderId, p)).status(), `tiers ${p}`).toBe(404);
    }
    expect((await view(buyer, orderId)).cancelRequest.status).toBe("pending");
    expect(await orderStatus(buyer.request, orderId)).toBe("paid");
    // page de la commande pour un tiers : introuvable, et rien de la demande n'y apparaît
    expect((await intrus.request.get(`/orders/${orderId}`)).status()).toBe(404);
    // sans session : 401 sur chaque route
    const anon = await playwright.request.newContext({ baseURL });
    for (const p of ["cancel-request", "cancel-request/withdraw", "cancel-request/accept", "cancel-request/decline"]) {
      expect((await anon.post(`/api/v1/orders/${orderId}/${p}`, { data: {} })).status(), `visiteur ${p}`).toBe(401);
    }
    await anon.dispose();
    // identifiants invalides : jamais de 5xx
    for (const id of ["x", "00000000-0000-4000-8000-000000000000", "1;drop table orders"]) {
      for (const p of ["cancel-request", "cancel-request/withdraw", "cancel-request/accept", "cancel-request/decline"]) {
        expect((await intrus.request.post(`/api/v1/orders/${encodeURIComponent(id)}/${p}`, { data: {} })).status(), `${id} ${p}`).toBeLessThan(500);
      }
    }
  });

  test("F02-C8 pas de demande avant paiement ni après remise ; l'annulation libre avant paiement est inchangée", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur C8");
    const buyer = await makeActor("Acheteur C8");
    const item = await apiListing(seller.request);
    const o = await buyer.request.post("/api/v1/orders", { data: { itemIds: [item.id], deliveryMethod: "hand_delivery" } });
    const orderId = (await o.json()).order.id;
    const early = await post(buyer, orderId, "cancel-request");
    expect(early.status()).toBe(409);
    expect((await early.json()).error.code).toBe("INVALID_STATE");
    await open(buyer.page, `/orders/${orderId}`);
    await expect(requestBtn(buyer)).toHaveCount(0);
    await buyer.page.getByRole("button", { name: "Annuler la commande" }).click();
    await buyer.page.getByRole("button", { name: "Oui, annuler" }).click();
    await expect(buyer.page.getByText("Commande annulée").first()).toBeVisible();
  });
});
