import { getData } from "@/lib/data";
import { asString, handle, json, num, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { itemCreate, parse } from "@/lib/schemas";
import { parseItemSort } from "@/lib/discovery";
import { currentUser, requireUser } from "@/lib/session";
import { CONDITIONS } from "@/lib/validation";

const CONDITION_VALUES = CONDITIONS.map((c) => c.value);
/** « condition=good,new » : valeurs inconnues ignorées. */
function conditionsParam(raw: string | null) {
  const list = (raw ?? "").split(",").map((s) => s.trim()).filter((s): s is (typeof CONDITION_VALUES)[number] => (CONDITION_VALUES as string[]).includes(s));
  return list.length ? list : undefined;
}

export async function GET(req: Request) {
  return handle(async () => {
    const p = new URL(req.url).searchParams;
    const viewer = await currentUser(); // agent H : état « favori » des cartes ; un visiteur reçoit favourited = false
    const items = await getData().listItems({
      sort: parseItemSort(p.get("sort")), // valeur inconnue ignorée
      offset: Math.min(Math.max(num(p.get("offset")) ?? 0, 0), 10_000),
      viewerId: viewer?.id ?? null,
      q: asString(p.get("q"), 100) || undefined,
      categoryId: p.get("category") ?? undefined,
      areaId: p.get("area") ?? undefined,
      lat: num(p.get("lat")),
      lng: num(p.get("lng")),
      radiusKm: num(p.get("radius_km")),
      minPriceUsdMinor: num(p.get("min_usd")),
      maxPriceUsdMinor: num(p.get("max_usd")),
      sellerId: p.get("seller") ?? undefined,
      brand: asString(p.get("brand"), 40) || undefined,
      sizeLabel: asString(p.get("size"), 20) || undefined,
      conditions: conditionsParam(p.get("condition")),
      limit: Math.min(num(p.get("limit")) ?? 60, 100),
    });
    return json({ items }, 200, viewer ? { Vary: "Cookie", "Cache-Control": "private, no-store" } : { Vary: "Cookie" });
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
