import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { clearSession, requireUser } from "@/lib/session";

// « Se déconnecter partout » : révoque toutes les sessions du membre, sur tous ses appareils.
export async function POST() {
  return handle(async () => {
    const me = await requireUser();
    await getData().deleteAllSessions(me.id);
    await clearSession();
    return json({ ok: true });
  });
}
