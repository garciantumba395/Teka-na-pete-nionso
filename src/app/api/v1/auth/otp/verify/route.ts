import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { clientIp, enforce } from "@/lib/ratelimit";
import { otpVerify, parse } from "@/lib/schemas";
import { setSession } from "@/lib/session";

export async function POST(req: Request) {
  return handle(async () => {
    const ip = clientIp(req);
    await enforce(`verify:ip:${ip}`, 30, 600);
    const body = parse(otpVerify, await readJson(req));
    const data = getData();
    const { user, isNew } = await data.verifyOtp(body.phone, body.code, body.displayName);
    const { token, expiresAt } = await data.createSession(user.id, { ip, userAgent: req.headers.get("user-agent")?.slice(0, 200) });
    await setSession(token, expiresAt);
    return json({ user: { id: user.id, displayName: user.displayName }, isNew });
  });
}
