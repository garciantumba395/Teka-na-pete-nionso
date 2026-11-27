import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { parse, parseId, reportHandle } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Signalement");
    const { action } = parse(reportHandle, await readJson(req));
    return json({ report: await getData().handleReport(me.id, id, action) });
  });
}
