import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// Annulation encadrée après paiement (voir DataLayer.withdrawCancellation).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    await enforce(`cancel-withdraw:user:${me.id}`, 20, 3600);
    return json({ order: await getData().withdrawCancellation(id, me.id) });
  });
}
