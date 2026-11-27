import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { mePatch, parse } from "@/lib/schemas";
import { clearSession, requireUser } from "@/lib/session";

export async function GET() {
  return handle(async () => json({ user: await requireUser() }));
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = parse(mePatch, await readJson(req));
    return json({ user: await getData().updateMe(me.id, body) });
  });
}

// Suppression de compte : anonymise le profil, révoque les sessions. Refusée s'il reste une commande ouverte ou de l'argent.
export async function DELETE() {
  return handle(async () => {
    const me = await requireUser();
    await getData().deleteAccount(me.id);
    await clearSession();
    return json({ ok: true });
  });
}
