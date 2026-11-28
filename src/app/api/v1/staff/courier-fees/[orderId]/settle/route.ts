import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

/** Assistance : marque les frais de livraison d'une commande comme réglés au coursier (écriture équilibrée, une seule fois). */
export async function POST(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`courier-settle:user:${me.id}`, 60, 3600);
    const orderId = parseId((await params).orderId, "Commande");
    return json({ settlement: await getData().settleCourierFee(me.id, orderId) });
  });
}
