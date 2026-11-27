import { getData } from "@/lib/data";
import { asString, handle, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/session";
import type { DeliveryMethod } from "@/lib/types";

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const b = await readJson(req);
    const order = await getData().createOrder(me.id, {
      itemIds: Array.isArray(b.itemIds) ? b.itemIds.filter((x): x is string => typeof x === "string").slice(0, 20) : [],
      deliveryMethod: (asString(b.deliveryMethod, 20) || "hand_delivery") as DeliveryMethod,
      deliveryAreaId: asString(b.deliveryAreaId, 60) || null,
      deliveryLandmark: asString(b.deliveryLandmark, 200) || null,
    });
    return json({ order: { id: order.id, status: order.status, totalMinor: order.totalMinor, currency: order.currency } }, 201);
  });
}
