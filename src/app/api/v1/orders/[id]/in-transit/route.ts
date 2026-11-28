import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

/** Vendeur (pour le compte du coursier) : le colis est en route. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    await readJson(req);
    return json({ order: await getData().markInTransit(id, me.id) });
  });
}
