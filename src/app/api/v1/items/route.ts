import { getData } from "@/lib/data";
import { asString, handle, json, num, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { itemCreate, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function GET(req: Request) {
  return handle(async () => {
    const p = new URL(req.url).searchParams;
    const items = await getData().listItems({
      q: asString(p.get("q"), 100) || undefined,
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
    await enforce(`items:user:${me.id}`, 30, 3600);
    const input = parse(itemCreate, await readJson(req));
    const item = await getData().createDraft(me.id, {
      ...input,
      sizeLabel: input.sizeLabel || null,
      brand: input.brand || null,
      areaId: input.areaId ?? null,
    });
    return json({ item: { id: item.id, status: item.status } }, 201);
  });
}
