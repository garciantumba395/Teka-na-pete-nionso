import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parse, parseId, reviewCreate } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    return json({ review: await getData().getMyReview(parseId((await params).id, "Commande"), me.id) });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Commande");
    await enforce(`review:user:${me.id}`, 20, 3600);
    const input = parse(reviewCreate, await readJson(req));
    return json({ review: await getData().createReview(id, me.id, input) }, 201);
  });
}
