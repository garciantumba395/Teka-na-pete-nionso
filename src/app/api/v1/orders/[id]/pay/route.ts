import { getData } from "@/lib/data";
import { asString, handle, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { AppError, type PaymentMethod } from "@/lib/types";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await params;
    const b = await readJson(req);
    const idempotencyKey = asString(b.idempotencyKey, 100);
    if (idempotencyKey.length < 8) throw new AppError("VALIDATION", "Clé d'idempotence manquante.", 422);
    const p = await getData().startPayment(id, me.id, {
      method: asString(b.method, 30) as PaymentMethod,
      msisdn: asString(b.msisdn, 30),
      idempotencyKey,
    });
    return json({ payment: { id: p.id, status: p.status, method: p.method, failureCode: p.failureCode } }, 202);
  });
}
