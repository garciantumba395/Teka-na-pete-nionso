import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { courierFeeModeInput, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

/** Administrateur : qui règle le coursier (`seller` ou `platform`). Ne touche que les libérations futures. */
export async function PUT(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const { mode } = parse(courierFeeModeInput, await readJson(req));
    return json({ mode: await getData().setCourierFeeMode(me.id, mode) });
  });
}
