import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Annonce");
    const item = await getData().publishItem(me.id, id);
    return json({ item: { id: item.id, status: item.status } });
  });
}
