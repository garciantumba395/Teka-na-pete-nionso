import { getData } from "@/lib/data";
import { asNumber, asString, handle, json, num, readJson } from "@/lib/http";
import { requireUser } from "@/lib/session";
import type { ListingInput } from "@/lib/validation";

export async function GET(req: Request) {
  return handle(async () => {
    const p = new URL(req.url).searchParams;
    const items = await getData().listItems({
      q: p.get("q") ?? undefined,
      categoryId: p.get("category") ?? undefined,
      areaId: p.get("area") ?? undefined,
      lat: num(p.get("lat")),
      lng: num(p.get("lng")),
      radiusKm: num(p.get("radius_km")),
      minPriceUsdMinor: num(p.get("min_usd")),
      maxPriceUsdMinor: num(p.get("max_usd")),
      sellerId: p.get("seller") ?? undefined,
      limit: Math.min(num(p.get("limit")) ?? 60, 100),
    });
    return json({ items });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const b = await readJson(req);
    const input: ListingInput = {
      title: asString(b.title, 200),
      description: asString(b.description, 5000),
      categoryId: asString(b.categoryId, 60),
      condition: asString(b.condition, 30),
      sizeLabel: asString(b.sizeLabel, 40) || null,
      brand: asString(b.brand, 80) || null,
      priceMinor: asNumber(b.priceMinor),
      currency: asString(b.currency, 3),
      areaId: asString(b.areaId, 60) || null,
      photos: Array.isArray(b.photos) ? b.photos.filter((x): x is string => typeof x === "string") : [],
    };
    const item = await getData().createDraft(me.id, input);
    return json({ item: { id: item.id, status: item.status } }, 201);
  });
}
