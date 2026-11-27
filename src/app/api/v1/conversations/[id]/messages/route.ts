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
    const { body } = parse(messageCreate, await readJson(req));
    return json({ message: await getData().sendMessage(id, me.id, body) }, 201);
  });
}
