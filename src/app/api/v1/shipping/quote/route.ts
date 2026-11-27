import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { parse, shippingQuote } from "@/lib/schemas";

/** Frais de livraison par coursier d'un article vers une commune. Public : aucune donnée personnelle. */
export async function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const input = parse(shippingQuote, { itemId: q.get("itemId") ?? "", areaId: q.get("areaId") ?? "" });
    return json({ quote: await getData().quoteShipping(input.itemId, input.areaId) }, 200, { "Cache-Control": "no-store" });
  });
}
