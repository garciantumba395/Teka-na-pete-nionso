import { assertProductionConfig } from "../config";
import { createPaymentProvider } from "../payments";
import { createSmsProvider } from "../sms/provider";
import { createFakeData } from "./fake";
import { createPgData } from "./pg/data";
import { createPool } from "./pg/pool";
import type { DataLayer } from "./types";

// Point d'entrée unique pour les écrans et les routes.
//   DATA_LAYER=fake (défaut) : couche en mémoire, démonstration et tests. Refusée en production.
//   DATA_LAYER=pg            : PostgreSQL (DATABASE_URL), SMS et paiement par les fournisseurs configurés.
const g = globalThis as unknown as { __marketplaceData?: DataLayer };

export function getData(): DataLayer {
  if (g.__marketplaceData) return g.__marketplaceData;
  assertProductionConfig(); // en production, refuse de démarrer avec des valeurs de développement
  const mode = process.env.DATA_LAYER ?? "fake";
  if (mode === "pg") {
    const provider = createPaymentProvider();
    g.__marketplaceData = createPgData(createPool(), { provider, sms: createSmsProvider(), autoComplete: provider.name === "fake", providerDelayMs: 3000 });
  } else if (mode === "fake") {
    // Singleton partagé entre rechargements à chaud et routes : l'état de démonstration survit au « fast refresh ».
    g.__marketplaceData = createFakeData({ autoComplete: true, providerDelayMs: 3000 });
  } else {
    throw new Error(`DATA_LAYER=${mode} inconnu (valeurs : fake, pg).`);
  }
  return g.__marketplaceData;
}

export type { DataLayer };
