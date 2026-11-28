import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { cartItem, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// ---- agent J : lots (panier d'un même vendeur)
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return json({ cart: await getData().getCart(me.id) }, 200, { "Cache-Control": "private, no-store" });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`cart:user:${me.id}`, 60, 600);
    const { itemId } = parse(cartItem, await readJson(req));
    return json({ cart: await getData().addToCart(me.id, itemId) }, 201);
  });
}
