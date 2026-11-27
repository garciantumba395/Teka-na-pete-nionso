import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { describeNotification } from "@/lib/notifications";
import { enforce } from "@/lib/ratelimit";
import { requireUser } from "@/lib/session";

// Un membre ne voit que SES notifications : l'identifiant vient de la session, jamais de la requête.
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`notif:list:${me.id}`, 120, 60);
    const { items, unreadCount } = await getData().listNotifications(me.id);
    return json(
      { unreadCount, notifications: items.map((n) => ({ id: n.id, kind: n.kind, read: n.read, createdAt: n.createdAt, ...describeNotification(n) })) },
      200, { "Cache-Control": "no-store" },
    );
  });
}
