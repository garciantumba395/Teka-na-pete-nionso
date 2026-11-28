import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

/** Assistance : frais de livraison en attente de règlement au coursier (mode « platform »). */
export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    const data = getData();
    return json({ dues: await data.listCourierDues(me.id), mode: await data.getCourierFeeMode() });
  });
}
