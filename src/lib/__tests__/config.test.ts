import { describe, expect, it } from "vitest";
import { productionProblems } from "../config";
import { authorizeJob } from "../jobs";

const GOOD = {
  NODE_ENV: "production", DATA_LAYER: "pg", DATABASE_URL: "postgres://x", PAYMENT_PROVIDER: "unpsp", SMS_PROVIDER: "unsms",
  HANDOVER_SECRET: "a".repeat(32), OTP_SECRET: "b".repeat(32), CRON_SECRET: "c".repeat(32), PSP_WEBHOOK_SECRET: "d".repeat(32),
};

describe("garde de configuration de production", () => {
  it("n'impose rien hors production", () => {
    expect(productionProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(productionProblems({})).toEqual([]);
  });
  it("refuse de démarrer avec les valeurs par défaut : couche factice, paiement factice, SMS console, secrets absents", () => {
    const p = productionProblems({ NODE_ENV: "production" }).join("\n");
    for (const needle of ["DATA_LAYER", "DATABASE_URL", "HANDOVER_SECRET", "OTP_SECRET", "CRON_SECRET", "PAYMENT_PROVIDER=fake", "SMS_PROVIDER=console"])
      expect(p).toContain(needle);
  });
  it("refuse un secret trop court ou resté à sa valeur de développement", () => {
    expect(productionProblems({ ...GOOD, HANDOVER_SECRET: "court" }).join()).toMatch(/HANDOVER_SECRET trop courte/);
    expect(productionProblems({ ...GOOD, OTP_SECRET: "dev-only-otp-secret-change-me" }).join()).toMatch(/OTP_SECRET trop courte/);
  });
  it("refuse un code SMS fixe en production", () => {
    expect(productionProblems({ ...GOOD, DEV_FIXED_OTP: "123456" }).join()).toMatch(/DEV_FIXED_OTP/);
  });
  it("le paiement factice n'est toléré qu'avec un drapeau explicite", () => {
    const base = { ...GOOD, PAYMENT_PROVIDER: "fake" };
    expect(productionProblems(base).join()).toMatch(/PAYMENT_PROVIDER=fake interdit/);
    expect(productionProblems({ ...base, ALLOW_FAKE_PAYMENTS: "1" }).join()).not.toMatch(/PAYMENT_PROVIDER=fake interdit/);
  });
  it("une configuration complète est acceptée", () => {
    expect(productionProblems(GOOD)).toEqual([]);
  });
});

describe("routes de tâches planifiées", () => {
  const code = (fn: () => void) => { try { fn(); } catch (e) { return (e as { code: string; status: number }); } return null; };
  it("sont fermées sans CRON_SECRET (jamais ouvertes par défaut)", () => {
    expect(code(() => authorizeJob("Bearer n-importe-quoi", undefined))?.status).toBe(503);
  });
  it("refusent un secret absent, faux ou de longueur différente", () => {
    for (const h of [null, "", "Bearer faux", "Bearer " + "x".repeat(40), "secret-sans-prefixe-faux"])
      expect(code(() => authorizeJob(h, "le-vrai-secret-de-test-123456"))?.status).toBe(401);
  });
  it("acceptent le bon secret", () => {
    expect(code(() => authorizeJob("Bearer le-vrai-secret-de-test-123456", "le-vrai-secret-de-test-123456"))).toBeNull();
  });
});
