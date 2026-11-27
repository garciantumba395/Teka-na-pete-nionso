import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";

export async function GET(req: Request) {
  return handle(async () => {
    const parent = new URL(req.url).searchParams.get("parent");
    return json({ areas: await getData().listAreas(parent === null ? undefined : parent) });
  });
}
