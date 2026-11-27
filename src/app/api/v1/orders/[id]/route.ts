import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await params;
    return json({ order: await getData().getOrder(id, me.id) });
  });
}
