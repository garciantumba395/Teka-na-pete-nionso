import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

/** Acheteur : « j'ai reçu le colis ». La fenêtre de réclamation démarre. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    await readJson(req);
    return json({ order: await getData().confirmReceived(id, me.id) });
  });
}
