import { getData } from "@/lib/data";
import { handle, json, readJson } from "@/lib/http";
import { enforce } from "@/lib/ratelimit";
import { conversationCreate, parse } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

export async function GET() {
  return handle(async () => {
    const me = await requireUser();
    return json({ conversations: await getData().listConversations(me.id) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const me = await requireUser();
    await enforce(`conv:user:${me.id}`, 30, 3600);
    const { itemId } = parse(conversationCreate, await readJson(req));
    const r = await getData().startConversation(me.id, itemId);
    return json({ conversation: { id: r.id } }, r.created ? 201 : 200);
  });
}
