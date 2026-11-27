import { describe, expect, it } from "vitest";
import { signPayload, verifySignature } from "../payments/provider";
import { decodeSession, encodeSession } from "../session";

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

describe("cookie de session signé", () => {
  it("relit un identifiant signé", () => {
    expect(decodeSession(encodeSession("user-123"))).toBe("user-123");
  });
  it("refuse un cookie falsifié ou mal formé", () => {
    const good = encodeSession("user-123");
    expect(decodeSession(good.replace("user-123", "user-999"))).toBeNull();
    expect(decodeSession("user-123")).toBeNull();
    expect(decodeSession("user-123.")).toBeNull();
    expect(decodeSession(".abc")).toBeNull();
    expect(decodeSession(undefined)).toBeNull();
  });
});
