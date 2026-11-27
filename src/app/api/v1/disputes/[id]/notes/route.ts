import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { disputeNote, parse, parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Litige");
    await enforce(`dispute-note:user:${me.id}`, 30, 3600);
    const { note } = parse(disputeNote, await readJson(req));
    return json({ dispute: await getData().addDisputeNote(id, me.id, note) }, 201);
  });
}
