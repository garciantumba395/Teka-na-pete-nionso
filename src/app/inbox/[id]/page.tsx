import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChatThread } from "@/components/client/ChatThread";
import { AppBar, Avatar } from "@/components/ui";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";
import { isAppError } from "@/lib/types";
import { parseIdOrNull } from "@/lib/schemas";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/inbox/${id}`)}`);
  if (!parseIdOrNull(id)) notFound();
  let conv;
  try {
    conv = await getData().getConversation(id, me.id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  const gone = conv.counterpart.displayName === "Membre supprimé";
  return (
    <div className="narrow">
      <AppBar title={conv.counterpart.displayName} back="/inbox" />
      <div className="pad stack">
        <Link href={`/items/${conv.itemId}`} className="row row-link">
          <span className="lead" style={{ minWidth: 0 }}>
            <Avatar name={conv.counterpart.displayName} />
            <span style={{ minWidth: 0 }}>
              <span className="hint" style={{ display: "block" }}>À propos de</span>
              <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.itemTitle}</strong>
            </span>
          </span>
        </Link>
        <ChatThread conversationId={conv.id} initial={conv.messages} canWrite={!gone} />
      </div>
    </div>
  );
}
