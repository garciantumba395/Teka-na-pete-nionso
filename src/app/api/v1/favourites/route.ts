import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { favouriteCreate, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// Un membre ne lit et n'écrit que SES favoris : l'identifiant vient de la session, jamais de la requête.
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`fav:read:${me.id}`, 120, 60);
    return json({ items: await getData().listFavourites(me.id) }, 200, { "Cache-Control": "no-store" });
  });
}

// Idempotent : remettre en favori une annonce déjà favorite répond 200 sans rien changer.
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`fav:write:${me.id}`, 60, 600);
    const { itemId } = parse(favouriteCreate, await readJson(req));
    return json(await getData().addFavourite(me.id, itemId), 200, { "Cache-Control": "no-store" });
  });
}
