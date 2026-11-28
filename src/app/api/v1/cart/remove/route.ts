import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { cartItem, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// ---- agent J : retrait d'un article du panier (POST JSON, comme le reste de l'API : jamais de requête modifiante sans corps JSON)
export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`cart:user:${me.id}`, 60, 600);
    const { itemId } = parse(cartItem, await readJson(req));
    return json({ cart: await getData().removeFromCart(me.id, itemId) });
  });
}
