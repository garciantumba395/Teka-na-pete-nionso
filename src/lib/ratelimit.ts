import { createHash } from "node:crypto";
import { getData } from "./data";
import { AppError } from "./types";

/**
 * Adresse du client. IMPORTANT : `x-forwarded-for` n'est fiable que derrière un proxy de confiance
 * (Vercel, Cloudflare…) qui écrase l'en-tête reçu. Sinon, un client peut le falsifier et contourner la limite par IP.
 */
export function clientIp(req: Request): string {
  const raw = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  // Empreinte tronquée : la limite fonctionne, mais aucune adresse IP n'est conservée en base.
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/** Lève 429 si la limite est dépassée. La clé ne contient jamais de donnée personnelle en clair (le téléphone est haché par l'appelant si besoin). */
export async function enforce(key: string, limit: number, windowSec: number): Promise<void> {
  const r = await getData().rateLimit(key, limit, windowSec);
  if (!r.allowed) {
    throw new AppError("RATE_LIMITED", "Trop de tentatives. Réessaie dans quelques instants.", 429, { retryAfter: String(r.retryAfterSec) });
  }
}
