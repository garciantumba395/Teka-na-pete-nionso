import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    return json({ dispute: await getData().getDisputeById(parseId((await params).id, "Litige"), me.id) });
  });
}
