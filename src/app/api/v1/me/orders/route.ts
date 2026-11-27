import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return json({ orders: await getData().listMyOrders(me.id) });
  });
}
