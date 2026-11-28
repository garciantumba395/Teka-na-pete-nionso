import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parse, parseId, payOrder } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    await enforce(`pay:user:${me.id}`, 10, 600);
    const b = parse(payOrder, await readJson(req));
    const p = await getData().startPayment(id, me.id, b);
    return json({ payment: { id: p.id, status: p.status, method: p.method, failureCode: p.failureCode } }, 202);
  });
}
