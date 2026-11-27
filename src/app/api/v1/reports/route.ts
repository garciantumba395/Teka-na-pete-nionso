import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parse, reportCreate } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`report:user:${me.id}`, 10, 3600);
    const input = parse(reportCreate, await readJson(req));
    const r = await getData().createReport(me.id, input);
    return json({ report: { id: r.id } }, r.created ? 201 : 200);
  });
}
