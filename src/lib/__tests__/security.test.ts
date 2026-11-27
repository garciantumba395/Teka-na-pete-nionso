import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../payments/provider";
import { itemCreate, orderCreate, otpVerify, parse, parseId, payoutCreate } from "../schemas";

describe("signature des webhooks", () => {
  const body = JSON.stringify({ eventId: "e1", type: "collection.succeeded", providerRef: "r1" });
  it("accepte une signature valide", () => {
    expect(verifySignature(body, signPayload(body))).toBe(true);
  });
  it("refuse une signature absente, fausse, ou sur un corps modifié", () => {
    expect(verifySignature(body, null)).toBe(false);
    expect(verifySignature(body, "abc")).toBe(false);
    expect(verifySignature(body.replace("r1", "r2"), signPayload(body))).toBe(false);
    expect(verifySignature(body, signPayload(body, "autre-secret"))).toBe(false);
  });
});

describe("reconnaissance des erreurs métier", () => {
  it("reconnaît une AppError d'un autre exemplaire de la classe (bundles Next.js séparés)", async () => {
    const { AppError, isAppError } = await import("../types");
    expect(isAppError(new AppError("X", "m", 409))).toBe(true);
    // Exemplaire « étranger » : même forme, classe différente, `instanceof` renvoie false.
    class Foreign extends Error {
      code = "NOT_FOUND";
      status = 404;
      constructor() {
        super("introuvable");
        this.name = "AppError";
      }
    }
    const foreign = new Foreign();
    expect(foreign instanceof AppError).toBe(false);
    expect(isAppError(foreign)).toBe(true);
  });
  it("refuse ce qui n'est pas une erreur métier", async () => {
    const { isAppError } = await import("../types");
    for (const v of [new Error("x"), { name: "AppError", code: "X", status: 400 }, null, "AppError", undefined])
      expect(isAppError(v)).toBe(false);
  });
});

describe("validation serveur des entrées (zod)", () => {
  const throwsCode = (fn: () => unknown) => {
    try { fn(); } catch (e) { return (e as { code?: string; status?: number; details?: Record<string, string> }); }
    throw new Error("aurait dû échouer");
  };
  it("refuse un code qui n'a pas 6 chiffres", () => {
    const e = throwsCode(() => parse(otpVerify, { phone: "0810000001", code: "12ab56" }));
    expect(e.code).toBe("VALIDATION");
    expect(e.status).toBe(422);
    expect(e.details?.code).toBeTruthy();
  });
  it("refuse des identifiants non-UUID dans une commande (pas d'injection de texte vers la base)", () => {
    expect(throwsCode(() => parse(orderCreate, { itemIds: ["1; drop table items"] })).details?.itemIds).toBeTruthy();
    expect(throwsCode(() => parse(orderCreate, { itemIds: [] })).code).toBe("VALIDATION");
  });
  it("refuse un montant non entier, négatif ou une devise inconnue", () => {
    const base = { method: "mpesa", msisdn: "0810000001", idempotencyKey: "abcdefgh1" };
    expect(throwsCode(() => parse(payoutCreate, { ...base, currency: "USD", amountMinor: 10.5 })).details?.amountMinor).toBeTruthy();
    expect(throwsCode(() => parse(payoutCreate, { ...base, currency: "USD", amountMinor: -5 })).details?.amountMinor).toBeTruthy();
    expect(throwsCode(() => parse(payoutCreate, { ...base, currency: "EUR", amountMinor: 1000 })).details?.currency).toBeTruthy();
  });
  it("limite le nombre et la taille des photos", () => {
    const item = { title: "t", categoryId: "00000000-0000-4000-8000-000000000000", condition: "good", priceMinor: 100, currency: "USD" };
    expect(throwsCode(() => parse(itemCreate, { ...item, photos: Array(21).fill("a") })).details?.photos).toMatch(/20/);
    expect(throwsCode(() => parse(itemCreate, { ...item, photos: ["x".repeat(600_001)] })).code).toBe("VALIDATION");
  });
  it("un identifiant d'URL invalide est une ressource introuvable (404), jamais une erreur serveur", () => {
    const e = throwsCode(() => parseId("inexistant", "Commande"));
    expect(e.status).toBe(404);
    expect(parseId("00000000-0000-4000-8000-000000000000")).toBeTruthy();
  });
});
