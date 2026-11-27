import type { CollectionRequest, PayoutRequest, PaymentProvider } from "./provider";

/**
 * Fournisseur factice de mobile money (bac à sable).
 * Règle de démo : un numéro qui se termine par « 00 » simule un refus (solde insuffisant / compte bloqué),
 * tout autre numéro est accepté. Aucun appel réseau. Interdit en production (voir config.ts).
 */
export class FakeMobileMoneyProvider implements PaymentProvider {
  readonly name = "fake";
  private n = 0;
  private msisdnByRef = new Map<string, string>();
  refunds: { providerRef: string; amountMinor: number }[] = [];

  async initiateCollection(req: CollectionRequest) {
    const providerRef = `fake_col_${++this.n}_${req.paymentId.slice(0, 8)}`;
    this.msisdnByRef.set(providerRef, req.msisdn);
    return { providerRef };
  }

  async initiatePayout(_req: PayoutRequest) {
    return { providerRef: `fake_pay_${++this.n}` };
  }

  async refund(args: { providerRef: string; amountMinor: number }) {
    this.refunds.push(args);
    return { ok: true };
  }

  /** Comme l'endpoint d'état d'un vrai PSP : le résultat est déjà connu. */
  async getCollection(providerRef: string) {
    const msisdn = this.msisdnByRef.get(providerRef);
    if (!msisdn) return { status: "pending" as const };
    return FakeMobileMoneyProvider.outcomeFor(msisdn) === "succeeded"
      ? { status: "succeeded" as const }
      : { status: "failed" as const, failureCode: "INSUFFICIENT_FUNDS" };
  }

  static outcomeFor(msisdn: string): "succeeded" | "failed" {
    return msisdn.endsWith("00") ? "failed" : "succeeded";
  }
}
