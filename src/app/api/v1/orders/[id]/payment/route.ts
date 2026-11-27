import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

// Interrogé régulièrement par l'écran de paiement (le webhook peut arriver avant ou après).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await params;
    const data = getData();
    const order = await data.getOrder(id, me.id);
    const p = await data.getPayment(id, me.id);
    return json({
      orderStatus: order.status,
      payment: p ? { id: p.id, status: p.status, method: p.method, failureCode: p.failureCode } : null,
    });
  });
}
