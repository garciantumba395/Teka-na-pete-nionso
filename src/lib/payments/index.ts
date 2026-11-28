import { FakeMobileMoneyProvider } from "./fake-provider";
import type { PaymentProvider } from "./provider";

/**
 * Choix du fournisseur de paiement par PAYMENT_PROVIDER.
 * Aujourd'hui seul « fake » existe. Brancher un vrai PSP = écrire une classe qui implémente PaymentProvider
 * (collecte, décaissement, remboursement, état), l'ajouter ici, et la faire passer par le contrat de
 * src/lib/__tests__/ contre le bac à sable du fournisseur. Voir replica/backend.md.
 * Le mode « fake » est refusé en production par config.ts.
 */
export function createPaymentProvider(): PaymentProvider {
  const name = process.env.PAYMENT_PROVIDER ?? "fake";
  if (name === "fake") return new FakeMobileMoneyProvider();
  throw new Error(`Fournisseur de paiement « ${name} » non implémenté (voir replica/backend.md).`);
}
