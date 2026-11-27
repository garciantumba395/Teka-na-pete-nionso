import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parse, payoutCreate } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return json({ payouts: await getData().listPayouts(me.id) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`payout:user:${me.id}`, 10, 3600);
    const b = parse(payoutCreate, await readJson(req));
    return json({ payout: await getData().requestPayout(me.id, b) }, 202);
  });
}
