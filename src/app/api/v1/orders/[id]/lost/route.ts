import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parse, parseId, reportLost } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

/** Acheteur ou vendeur : « colis perdu ». Ouvre un litige (motif : non reçu). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    await enforce(`dispute:user:${me.id}`, 10, 3600);
    const b = parse(reportLost, await readJson(req));
    return json({ dispute: await getData().reportParcelLost(id, me.id, { description: b.description }) }, 201);
  });
}
