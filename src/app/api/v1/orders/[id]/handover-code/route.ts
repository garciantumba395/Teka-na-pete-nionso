import { getData } from "@/lib/data";
import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/session";

// Acheteur seulement. Le code est dérivé côté serveur, jamais stocké en clair.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const { id } = await params;
    const code = await getData().getHandoverCode(id, me.id);
    return json({ code }, 200, { "Cache-Control": "no-store" });
  });
}
