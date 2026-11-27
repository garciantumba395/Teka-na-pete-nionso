import { getData } from "@/lib/data";
import { asNumber, asString, handle, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { AppError, type Currency, type PaymentMethod } from "@/lib/types";

export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return json({ payouts: await getData().listPayouts(me.id) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const b = await readJson(req);
    const idempotencyKey = asString(b.idempotencyKey, 100);
    if (idempotencyKey.length < 8) throw new AppError("VALIDATION", "Clé d'idempotence manquante.", 422);
    const p = await getData().requestPayout(me.id, {
      amountMinor: asNumber(b.amountMinor),
      currency: asString(b.currency, 3) as Currency,
      method: asString(b.method, 30) as PaymentMethod,
      msisdn: asString(b.msisdn, 30),
      idempotencyKey,
    });
    return json({ payout: p }, 202);
  });
}
