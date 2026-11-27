import { randomUUID } from "node:crypto";
import { signPayload } from "../../src/lib/payments/provider";
import { CRON_SECRET, ID, apiBuyAndPay, apiListing, apiOrder, expect, isPg, open, randomIp, test, uniqueTitle } from "../support";

test.describe("SEC Sécurité", () => {
  test("SEC-1 un tiers sur toutes les routes d'une commande : 404 partout, commande intacte", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur sec");
    const buyer = await makeActor("Acheteur sec");
    const intrus = await makeActor("Intrus sec");
    const item = await apiListing(seller.request);
    const orderId = await apiBuyAndPay(buyer.request, item.id);
    const base = `/api/v1/orders/${orderId}`;
    const calls: [string, () => Promise<{ status(): number }>][] = [
      ["GET order", () => intrus.request.get(base)],
      ["GET payment", () => intrus.request.get(`${base}/payment`)],
      ["GET handover-code", () => intrus.request.get(`${base}/handover-code`)],
      ["POST cancel", () => intrus.request.post(`${base}/cancel`, { data: {} })],
      ["POST accept", () => intrus.request.post(`${base}/accept`, { data: {} })],
      ["POST confirm-delivery", () => intrus.request.post(`${base}/confirm-delivery`, { data: { code: "123456" } })],
      ["POST pay", () => intrus.request.post(`${base}/pay`, { data: { method: "mpesa", msisdn: "0810000001", idempotencyKey: "intrus-key-1" } })],
    ];
    for (const [label, fn] of calls) expect((await fn()).status(), label).toBe(404);
    expect((await (await buyer.request.get(base)).json()).order.status).toBe("paid");
  });

  test("SEC-2 identifiants invalides sur toutes les routes à identifiant : jamais 5xx", async ({ makeActor }) => {
    const a = await makeActor("Id invalides");
    const values = ["x", "1;drop table items", "..%2F..%2Fetc%2Fpasswd", "%00", "00000000-0000-4000-8000-000000000000", "a".repeat(3000), "%F0%9F%8C%8D"];
    for (const v of values) {
      const e = v.includes("%") ? v : encodeURIComponent(v);
      const gets = [`/api/v1/items/${e}`, `/api/v1/orders/${e}`, `/api/v1/orders/${e}/payment`, `/api/v1/orders/${e}/handover-code`, `/api/v1/photos/${e}`];
      for (const g of gets) expect((await a.request.get(g)).status(), `GET ${g.slice(0, 60)}`).toBeLessThan(500);
      const posts = [`/api/v1/items/${e}/publish`, `/api/v1/orders/${e}/cancel`, `/api/v1/orders/${e}/accept`, `/api/v1/orders/${e}/confirm-delivery`, `/api/v1/orders/${e}/pay`];
      for (const p of posts) {
        const r = await a.request.post(p, { data: { code: "123456", method: "mpesa", msisdn: "0810000001", idempotencyKey: "invalid-id-key" } });
        expect(r.status(), `POST ${p.slice(0, 60)}`).toBeLessThan(500);
      }
      for (const pg of [`/items/${e}`, `/orders/${e}`, `/orders/${e}/pay`, `/members/${e}`]) {
        expect((await a.request.get(pg)).status(), `page ${pg.slice(0, 60)}`).toBeLessThan(500);
      }
    }
  });

  test("SEC-3 octet nul et caractères de contrôle dans la recherche et les champs : jamais 5xx", async ({ makeActor, request }) => {
    const buyer = await makeActor("Nul acheteur");
    const seller = await makeActor("Nul vendeur");
    const item = await apiListing(seller.request);
    for (const q of ["%00", "a%00b", "%07", "%1B%5B31m", "%EF%BF%BD", "%E2%80%AE"]) {
      expect((await request.get(`/api/v1/items?q=${q}`)).status(), `q=${q}`).toBeLessThan(500);
      expect((await request.get(`/search?q=${q}`)).status(), `page q=${q}`).toBeLessThan(500);
    }
    const o = await buyer.request.post("/api/v1/orders", { data: { itemIds: [item.id], deliveryMethod: "hand_delivery", deliveryLandmark: "près du marché\u0000central" } });
    expect(o.status(), "repère avec octet nul").toBeLessThan(500);
    const p = await buyer.request.patch("/api/v1/me", { data: { bio: "bio\u0000nul", displayName: "Nom\u0000nul" } });
    expect(p.status(), "profil avec octet nul").toBeLessThan(500);
    const ph = await request.post("/api/v1/auth/otp", { data: { phone: "0810\u0000000001" }, headers: { "x-forwarded-for": randomIp() } });
    expect(ph.status(), "numéro avec octet nul").toBeLessThan(500);
    const key = await buyer.request.post(`/api/v1/orders/${randomUUID()}/pay`, { data: { method: "mpesa", msisdn: "0810000001", idempotencyKey: "cle\u0000nulle-1234" } });
    expect(key.status(), "clé d'idempotence avec octet nul").toBeLessThan(500);
  });

  test("SEC-4 méta-caractères de recherche : traités comme du texte, jamais comme un motif", async ({ makeActor, request }) => {
    const s = await makeActor("Méta");
    const token = Date.now().toString(36).replace(/\d/g, "q");
    const title = `Zq9Ab ${token}`;
    const item = await apiListing(s.request, { title });
    const find = async (q: string) => ((await (await request.get(`/api/v1/items?q=${encodeURIComponent(q)}&limit=100`)).json()).items as { id: string }[]).map((i) => i.id);
    expect(await find(`Zq9Ab ${token}`)).toContain(item.id);
    expect(await find(`Zq_Ab ${token}`), "« _ » ne doit pas jouer le rôle de joker").not.toContain(item.id);
    expect(await find(`Z%b ${token}`), "« % » ne doit pas jouer le rôle de joker").not.toContain(item.id);
    for (const q of ["'", '"', "\\", "%", "_", "100%", "'; drop table items;--", "' OR '1'='1", "%_", "\\\\"]) {
      const r = await request.get(`/api/v1/items?q=${encodeURIComponent(q)}`);
      expect(r.status(), `q=${q}`).toBe(200);
    }
  });

  test("SEC-5 charges XSS dans le profil : aucune exécution", async ({ makeActor }) => {
    const a = await makeActor("Profil xss");
    const viewer = await makeActor("Spectateur");
    let dialogs = 0;
    viewer.page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
    const payload = '"><img src=x onerror=window.__xss=1><script>window.__xss=1</script>';
    const r = await a.request.patch("/api/v1/me", { data: { bio: payload } });
    expect(r.status()).toBe(200);
    await open(viewer.page, `/members/${a.userId}`);
    expect(await viewer.page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(await viewer.page.locator("img[src=x]").count()).toBe(0);
    expect(dialogs).toBe(0);
    await expect(viewer.page.getByText(payload.slice(0, 20), { exact: false })).toBeVisible(); // affiché comme texte
  });

  test("SEC-6 webhook : sans signature, signature fausse, corps modifié → 401 ; référence inconnue → 409", async ({ request }) => {
    const body = JSON.stringify({ eventId: `evt-${Date.now()}`, type: "collection.succeeded", providerRef: "ref-inconnue" });
    const url = "/api/v1/webhooks/psp/fake";
    const h = { "content-type": "application/json" };
    expect((await request.post(url, { data: body, headers: h })).status()).toBe(401);
    expect((await request.post(url, { data: body, headers: { ...h, "x-signature": "0".repeat(64) } })).status()).toBe(401);
    expect((await request.post(url, { data: body.replace("ref-inconnue", "autre-ref"), headers: { ...h, "x-signature": signPayload(body) } })).status()).toBe(401);
    const unknown = await request.post(url, { data: body, headers: { ...h, "x-signature": signPayload(body) } });
    expect(unknown.status()).toBe(409);
    expect((await unknown.json()).error.code).toBe("UNKNOWN_REFERENCE");
    expect((await request.post("/api/v1/webhooks/psp/inconnu", { data: body, headers: h })).status()).toBe(404);
  });

  test("SEC-7 tâches planifiées : sans secret 401, mauvais secret 401, bon secret 200", async ({ request }) => {
    expect((await request.get("/api/internal/jobs/purge_expired")).status()).toBe(401);
    expect((await request.get("/api/internal/jobs/purge_expired", { headers: { authorization: "Bearer faux" } })).status()).toBe(401);
    const ok = await request.get("/api/internal/jobs/all", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.status()).toBe(200);
    expect(Object.keys((await ok.json()).result).sort()).toEqual(["expire_unpaid_orders", "purge_expired", "reconcile_pending_payments", "refund_stale_courier_orders", "refund_unhanded_orders", "release_delivered_orders"]);
    expect((await request.get("/api/internal/jobs/inconnue", { headers: { authorization: `Bearer ${CRON_SECRET}` } })).status()).toBe(404);
  });

  test("SEC-8 en-têtes de sécurité sur les pages", async ({ request }) => {
    for (const path of ["/", "/signin", "/search"]) {
      const h = (await request.get(path)).headers();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["referrer-policy"], path).toBeTruthy();
      expect(h["permissions-policy"], path).toContain("camera=(self)");
      expect(h["x-powered-by"], path).toBeUndefined();
    }
  });

  test("SEC-9 JSON invalide, corps énorme, mauvais type de contenu : jamais 5xx", async ({ request }) => {
    const ip = { "x-forwarded-for": randomIp() };
    const bad = await request.post("/api/v1/auth/otp", { data: Buffer.from("{pas du json"), headers: { ...ip, "content-type": "application/json" } }); // octets bruts : sinon Playwright encode la chaîne en JSON valide
    expect(bad.status()).toBe(400);
    for (const body of ["null", "[]", '"texte"', "123", "{}"]) {
      const r = await request.post("/api/v1/auth/otp", { data: Buffer.from(body), headers: { ...ip, "content-type": "application/json" } });
      expect(r.status(), `corps ${body}`).toBeLessThan(500);
    }
    const huge = await request.post("/api/v1/auth/otp", { data: { phone: "0".repeat(16 * 1024 * 1024) }, headers: ip });
    expect(huge.status()).toBe(413);
    // défense en profondeur : un changement d'état ne doit accepter que du JSON (un formulaire « text/plain » ne doit pas passer)
    const plain = await request.post("/api/v1/auth/otp", { data: Buffer.from(JSON.stringify({ phone: "0810000001" })), headers: { ...ip, "content-type": "text/plain" } });
    expect(plain.status(), "un corps text/plain ne devrait pas être accepté (CSRF par formulaire)").toBeGreaterThanOrEqual(400);
  });

  test("SEC-10 12 commandes en 10 minutes par le même membre : 429 au-delà de 10", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur lim");
    const buyer = await makeActor("Acheteur lim");
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const it = await apiListing(seller.request, { title: uniqueTitle("Lim") });
      statuses.push((await buyer.request.post("/api/v1/orders", { data: { itemIds: [it.id], deliveryMethod: "hand_delivery" } })).status());
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  test("SEC-11 le client ne peut imposer ni total, ni statut, ni rôle", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur masse");
    const buyer = await makeActor("Acheteur masse");
    const item = await apiListing(seller.request, { priceMinor: 10_000 });
    const r = await buyer.request.post("/api/v1/orders", { data: { itemIds: [item.id], deliveryMethod: "hand_delivery", totalMinor: 1, status: "paid", buyerId: seller.userId, protectionFeeMinor: 0 } });
    const o = (await r.json()).order;
    expect(o.totalMinor).toBe(10_500);
    expect(o.status).toBe("pending_payment");
    const before = (await (await buyer.request.get("/api/v1/me")).json()).user;
    const p = await buyer.request.patch("/api/v1/me", { data: { role: "admin", status: "banned", ratingAvg: 5, ratingCount: 999, verificationLevel: "id", phone: "+243999999999", id: seller.userId } });
    expect(p.status()).toBeLessThan(500);
    const after = (await (await buyer.request.get("/api/v1/me")).json()).user;
    for (const k of ["id", "phone", "ratingAvg", "ratingCount", "verificationLevel"]) expect(after[k], k).toEqual(before[k]);
    expect(after.role ?? "member", "le rôle ne peut pas être modifié par le client").toBe("member");
    expect((await buyer.request.get("/api/v1/staff/disputes")).status(), "aucune élévation de privilège").toBe(404);
    expect((await buyer.request.get("/api/v1/staff/reports")).status()).toBe(404);
  });

  test("SEC-12 photos : identifiant invalide 404 ; en-têtes de sécurité et cache immuable", async ({ makeActor, request }) => {
    test.skip(!isPg(), "les photos ne sont servies par la route que sur la couche PostgreSQL");
    const s = await makeActor("Photos");
    expect((await request.get("/api/v1/photos/x")).status()).toBe(404);
    expect((await request.get(`/api/v1/photos/${randomUUID()}`)).status()).toBe(404);
    const item = await apiListing(s.request);
    const detail = (await (await s.request.get(`/api/v1/items/${item.id}`)).json()).item;
    const res = await request.get(detail.photos[0]);
    const h = res.headers();
    expect(res.status()).toBe(200);
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("sandbox");
    expect(h["cache-control"]).toContain("immutable");
    expect(h["content-type"]).toMatch(/^image\//);
  });

  void ID;
});
