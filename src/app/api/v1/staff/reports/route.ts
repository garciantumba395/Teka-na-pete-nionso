import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

export async function GET(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const s = new URL(req.url).searchParams.get("status");
    const status = s === "actioned" || s === "dismissed" ? s : "open";
    return json({ reports: await getData().listReports(me.id, status) });
  });
}
