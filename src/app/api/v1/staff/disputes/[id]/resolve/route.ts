import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { disputeResolve, parse, parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Litige");
    const { outcome, note } = parse(disputeResolve, await readJson(req));
    return json({ dispute: await getData().resolveDispute(me.id, id, outcome, note) });
  });
}
