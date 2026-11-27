import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { requireUser } from "@/lib/session";

export async function POST() {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`notif:write:${me.id}`, 120, 60);
    const marked = await getData().markAllNotificationsRead(me.id);
    return json({ ok: true, marked, unreadCount: 0 });
  });
}
