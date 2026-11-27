import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { verifySignature } from "@/lib/payments/provider";
import { AppError, type ProviderEvent } from "@/lib/types";

const TYPES = ["collection.succeeded", "collection.failed", "payout.succeeded", "payout.failed"] as const;

// Webhook entrant du PSP. Signature HMAC vérifiée sur le corps BRUT avant tout traitement ;
// le traitement est idempotent (un événement rejoué ne change rien).
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  return handle(async () => {
    const { provider } = await params;
    if (provider !== "fake") throw new AppError("NOT_FOUND", "Fournisseur inconnu.", 404);
    const raw = await req.text();
    if (!verifySignature(raw, req.headers.get("x-signature"))) throw new AppError("BAD_SIGNATURE", "Signature invalide.", 401);
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new AppError("BAD_JSON", "Requête illisible.", 400);
    }
    const type = TYPES.find((t) => t === b.type);
    if (!type || typeof b.eventId !== "string" || typeof b.providerRef !== "string")
      throw new AppError("VALIDATION", "Événement invalide.", 422);
    const ev: ProviderEvent = {
      eventId: b.eventId, type, providerRef: b.providerRef,
      failureCode: typeof b.failureCode === "string" ? b.failureCode : undefined,
    };
    const r = await getData().handleProviderEvent(ev);
    return json({ received: true, duplicate: r.duplicate });
  });
}
