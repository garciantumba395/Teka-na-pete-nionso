import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { notificationPrefsPatch, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// Seuls les SMS se règlent, par catégorie. Les notifications internes ne se désactivent pas.
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`notif:list:${me.id}`, 120, 60);
    return json({ preferences: await getData().getNotificationPreferences(me.id) }, 200, { "Cache-Control": "no-store" });
  });
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`notif:prefs:${me.id}`, 60, 3600);
    const patch = parse(notificationPrefsPatch, await readJson(req));
    return json({ preferences: await getData().updateNotificationPreferences(me.id, patch) });
  });
}
