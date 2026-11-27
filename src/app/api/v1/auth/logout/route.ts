import { handle, json } from "@/lib/http";
import { clearSession } from "@/lib/session";

export async function POST() {
  return handle(async () => {
    await clearSession();
    return json({ ok: true });
  });
}
