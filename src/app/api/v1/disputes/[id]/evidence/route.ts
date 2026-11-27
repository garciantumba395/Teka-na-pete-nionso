import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { disputeEvidence, parse, parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// Ajoute une photo de preuve (et une note facultative) à un litige : les deux parties et l'assistance.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Litige");
    await enforce(`dispute-evidence:user:${me.id}`, 20, 3600);
    const { photo, note } = parse(disputeEvidence, await readJson(req));
    return json({ dispute: await getData().addDisputeEvidence(id, me.id, { photo, note }) }, 201);
  });
}
