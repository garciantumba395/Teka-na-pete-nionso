import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { disputeOpen, parse, parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    return json({ dispute: await getData().getOrderDispute(id, me.id) });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    await enforce(`dispute:user:${me.id}`, 10, 3600);
    const input = parse(disputeOpen, await readJson(req));
    return json({ dispute: await getData().openDispute(id, me.id, input) }, 201);
  });
}
