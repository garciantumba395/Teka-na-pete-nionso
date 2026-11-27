import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { confirmDelivery, parse, parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    const b = parse(confirmDelivery, await readJson(req));
    // Le nombre d'essais est limité PAR COMMANDE dans la couche de données (5 essais, puis verrouillage).
    return json({ order: await getData().confirmDelivery(id, me.id, b.code) });
  });
}
