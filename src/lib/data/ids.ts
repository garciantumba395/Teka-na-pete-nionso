import { createHash } from "node:crypto";

/**
 * UUID déterministe (type v5) à partir d'un nom lisible : « cat-robes » donne toujours le même identifiant.
 * Sert aux données de référence et de démonstration, pour que la couche factice, PostgreSQL, les tests
 * et le parcours E2E parlent des mêmes enregistrements.
 */
export function seedId(name: string): string {
  const h = createHash("sha1").update(`marketplace-rdc:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
