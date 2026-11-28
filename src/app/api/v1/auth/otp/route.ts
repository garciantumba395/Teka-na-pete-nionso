import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { clientIp, enforce } from "@/lib/ratelimit";
import { otpRequest, parse } from "@/lib/schemas";

export async function POST(req: Request) {
  return handle(async () => {
    await enforce(`otp:ip:${clientIp(req)}`, 20, 600);
    const body = parse(otpRequest, await readJson(req));
    const r = await getData().requestOtp(body.phone);
    return json({ phone: r.phone, devCode: r.devCode });
  });
}
