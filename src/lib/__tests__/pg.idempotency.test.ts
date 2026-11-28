import { afterAll, describe, expect, it } from "vitest";
import { seedId as S } from "../data/ids";
import type { AppError, User } from "../types";
import { endTestPool, makePgEnv, TEST_URL } from "./pg-env";

const suite = TEST_URL ? describe : describe.skip;
afterAll(endTestPool);

suite("PostgreSQL : clé d'idempotence de paiement", () => {
  it("deux commandes de membres différents qui prennent la même clé en même temps : une réussit, l'autre reçoit un 409 propre (jamais une erreur interne)", async () => {
    const env = await makePgEnv();
    const data = env.data;
    const seller = (await data.getUser(S("user-marie")))!;
    const buyers: User[] = [];
    for (const [phone, name] of [["0821000301", "Acheteur Clé A"], ["0821000302", "Acheteur Clé B"]] as const) {
      await data.requestOtp(phone);
      buyers.push((await data.verifyOtp(phone, "123456", name)).user);
    }
    // La course est étroite (deux transactions doivent passer le SELECT avant l'INSERT de l'autre) : on la rejoue
    // plusieurs fois, avec des clés différentes à chaque tour, pour que le test échoue réellement sans la correction.
    let conflicts = 0;
    for (let round = 0; round < 25; round++) {
      const orders = [];
      for (const b of buyers) {
        const d = await data.createDraft(seller.id, { title: `Robe clé ${round} ${b.displayName}`, description: "", categoryId: S("cat-robes"), condition: "good", priceMinor: 2500, currency: "USD", areaId: S("area-com-gombe"), photos: ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ"] });
        const item = await data.publishItem(seller.id, d.id);
        orders.push(await data.createOrder(b.id, { itemIds: [item.id], deliveryMethod: "hand_delivery" }));
      }
      const results = await Promise.allSettled(
        orders.map((o, i) => data.startPayment(o.id, buyers[i].id, { method: "mpesa", msisdn: "0821111111", idempotencyKey: `cle-partagee-${round}` })),
      );
      const ko = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
      for (const r of ko) {
        expect((r.reason as AppError).code, "jamais d'erreur interne").toBe("IDEMPOTENCY_CONFLICT");
        expect((r.reason as AppError).status).toBe(409);
        conflicts++;
      }
    }
    expect(conflicts).toBeGreaterThan(0); // la course a bien eu lieu
  });
});
