import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { verifySignature } from "@/lib/payments/provider";
import { parse, webhookEvent } from "@/lib/schemas";
import { AppError } from "@/lib/types";

// Webhook entrant du PSP. Signature HMAC vérifiée sur le corps BRUT avant tout traitement ;
// le traitement est idempotent (un événement rejoué ne change rien).
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  return handle(async () => {
    const { provider } = await params;
    if (provider !== "fake") throw new AppError("NOT_FOUND", "Fournisseur inconnu.", 404);
    const raw = await req.text();
    if (!verifySignature(raw, req.headers.get("x-signature"))) throw new AppError("BAD_SIGNATURE", "Signature invalide.", 401);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError("BAD_JSON", "Requête illisible.", 400);
    }
    const ev = parse(webhookEvent, parsed);
    const r = await getData().handleProviderEvent(ev);
    // Référence inconnue (pas encore enregistrée) : réponse non-2xx pour que le PSP rejoue l'événement.
    if (r.matched === false) throw new AppError("UNKNOWN_REFERENCE", "Référence inconnue, réessaie plus tard.", 409);
    return json({ received: true, duplicate: r.duplicate });
  });
}
