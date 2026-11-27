import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { clearSession, currentToken } from "@/lib/session";

export async function POST() {
  return handle(async () => {
    const token = await currentToken();
    if (token) await getData().deleteSession(token);
    await clearSession();
    return json({ ok: true });
  });
}
