import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";

export async function GET() {
  return handle(async () => json({ categories: await getData().listCategories() }));
}
