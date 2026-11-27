import { getData } from "@/lib/data";
import { asString, handle, json, readJson } from "@/lib/http";
import { requireUser } from "@/lib/session";

export async function GET() {
  return handle(async () => json({ user: await requireUser() }));
}

export async function PATCH(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    const body = await readJson(req);
    const user = await getData().updateMe(me.id, {
      displayName: body.displayName === undefined ? undefined : asString(body.displayName, 60),
      bio: body.bio === undefined ? undefined : asString(body.bio, 500),
      areaId: body.areaId === undefined ? undefined : body.areaId === null ? null : asString(body.areaId, 60),
    });
    return json({ user });
  });
}
