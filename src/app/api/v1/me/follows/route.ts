import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { followInput, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

const NO_STORE = { "Cache-Control": "no-store" };

// Marques et tailles suivies par le membre connecté (alimentent « Pour toi » sur l'accueil).
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`follow:read:${me.id}`, 120, 60);
    return json({ follows: await getData().getFollows(me.id) }, 200, NO_STORE);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`follow:write:${me.id}`, 60, 600);
    const { kind, value } = parse(followInput, await readJson(req));
    return json({ follows: await getData().addFollow(me.id, kind, value) }, 200, NO_STORE);
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`follow:write:${me.id}`, 60, 600);
    const { kind, value } = parse(followInput, await readJson(req));
    return json({ follows: await getData().removeFollow(me.id, kind, value) }, 200, NO_STORE);
  });
}
