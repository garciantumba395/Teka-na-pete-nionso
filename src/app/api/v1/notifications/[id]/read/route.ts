import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// Notification d'un autre membre ou identifiant invalide : 404 (on ne confirme pas son existence).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`notif:write:${me.id}`, 120, 60);
    const id = parseId((await params).id, "Notification");
    await getData().markNotificationRead(me.id, id);
    return json({ ok: true, unreadCount: await getData().countUnreadNotifications(me.id) });
  });
}
