import { getData } from "@/lib/data";
import { asString, handle, json, readJson } from "@/lib/http";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const r = await getData().requestOtp(asString(body.phone, 30));
    return json({ phone: r.phone, devCode: r.devCode });
  });
}
