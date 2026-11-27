import { getData } from "@/lib/data";
import { asString, handle, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await params;
    const b = await readJson(req);
    return json({ order: await getData().confirmDelivery(id, me.id, asString(b.code, 12)) });
  });
}
