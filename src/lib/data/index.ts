import { createFakeData, type FakeData } from "./fake";
import type { DataLayer } from "./types";

// Point d'entrée unique pour les écrans et les routes. Aujourd'hui : couche factice en mémoire.
// `/replica-backend` ajoutera l'implémentation réelle (Supabase + PSP) derrière la même interface DataLayer.
const g = globalThis as unknown as { __marketplaceData?: FakeData };

export function getData(): DataLayer {
  const mode = process.env.DATA_LAYER ?? "fake";
  if (mode !== "fake") throw new Error(`DATA_LAYER=${mode} : la couche réelle n'est pas branchée (voir /replica-backend).`);
  // Singleton partagé entre rechargements à chaud et routes : l'état de démonstration survit au « fast refresh ».
  g.__marketplaceData ??= createFakeData({ autoComplete: true, providerDelayMs: 3000 });
  return g.__marketplaceData;
}

export type { DataLayer };
