import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { messageCreate, parse, parseId } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseId((await params).id, "Conversation");
    // 40 messages par 10 minutes : assez pour discuter, pas pour inonder quelqu'un.
    await enforce(`msg:user:${me.id}`, 40, 600);
    const { body, photo } = parse(messageCreate, await readJson(req));
    if (photo) {
      // Les photos pèsent et se stockent : limite plus basse que pour le texte (10 par 10 minutes).
      await enforce(`msg-photo:user:${me.id}`, 10, 600);
      return json({ message: await getData().sendPhotoMessage(id, me.id, { body, photo }) }, 201);
    }
    return json({ message: await getData().sendMessage(id, me.id, body) }, 201);
  });
}
