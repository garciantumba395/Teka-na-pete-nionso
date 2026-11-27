import type { CollectionRequest, PayoutRequest, PaymentProvider } from "./provider";

/**
 * Fournisseur factice de mobile money (bac à sable).
 * Règle de démo : un numéro qui se termine par « 00 » simule un refus (solde insuffisant / compte bloqué),
 * tout autre numéro est accepté. Aucun appel réseau.
 */
export class FakeMobileMoneyProvider implements PaymentProvider {
  readonly name = "fake";
  private n = 0;
  refunds: { providerRef: string; amountMinor: number }[] = [];

  async initiateCollection(_req: CollectionRequest) {
    return { providerRef: `fake_col_${++this.n}` };
  }

  async initiatePayout(_req: PayoutRequest) {
    return { providerRef: `fake_pay_${++this.n}` };
  }

  async refund(args: { providerRef: string; amountMinor: number }) {
    this.refunds.push(args);
    return { ok: true };
  }

  static outcomeFor(msisdn: string): "succeeded" | "failed" {
    return msisdn.endsWith("00") ? "failed" : "succeeded";
  }
}
