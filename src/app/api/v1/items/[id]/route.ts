import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { currentUser } from "@/lib/session";
import { AppError } from "@/lib/types";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const me = await currentUser();
    const item = await getData().getItem(id, me?.id);
    if (!item) throw new AppError("NOT_FOUND", "Annonce introuvable.", 404);
    return json({ item });
  });
}
