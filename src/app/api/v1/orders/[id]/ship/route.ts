import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parse, parseId, shipOrder } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

/** Vendeur : renseigne le coursier et marque le colis « remis au coursier ». */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    await enforce(`ship:user:${me.id}`, 30, 3600);
    const b = parse(shipOrder, await readJson(req));
    return json({ order: await getData().shipOrder(id, me.id, { courierName: b.courierName, courierPhone: b.courierPhone, trackingRef: b.trackingRef ?? null }) });
  });
}
