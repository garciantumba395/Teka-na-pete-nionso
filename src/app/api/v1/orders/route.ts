import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { orderCreate, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    // Frein au blocage d'articles : une réservation retient l'article jusqu'à 15 minutes sans paiement.
    await enforce(`orders:user:${me.id}`, 10, 600);
    const body = parse(orderCreate, await readJson(req));
    const order = await getData().createOrder(me.id, {
      itemIds: body.itemIds,
      deliveryMethod: body.deliveryMethod,
      deliveryAreaId: body.deliveryAreaId ?? null,
      deliveryLandmark: body.deliveryLandmark ?? null,
    });
    return json({ order: { id: order.id, status: order.status, totalMinor: order.totalMinor, currency: order.currency } }, 201);
  });
}
