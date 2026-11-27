import { getData } from "@/lib/data";
import { asString, handle, json, readJson } from "@/lib/http";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const { user, isNew } = await getData().verifyOtp(
      asString(body.phone, 30),
      asString(body.code, 12),
      body.displayName === undefined ? undefined : asString(body.displayName, 60),
    );
    await setSession(user.id);
    return json({ user: { id: user.id, displayName: user.displayName }, isNew });
  });
}
