import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// Retire un favori. Idempotent : retirer ce qui n'y est pas répond 200 (un identifiant invalide : 404).
export async function DELETE(_req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`fav:write:${me.id}`, 60, 600);
    const itemId = parseId((await params).itemId, "Annonce");
    return json(await getData().removeFavourite(me.id, itemId), 200, { "Cache-Control": "no-store" });
  });
}
