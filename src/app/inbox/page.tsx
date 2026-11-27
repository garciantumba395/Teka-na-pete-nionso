import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar, EmptyState } from "@/components/ui";
import { AppBar } from "@/components/ui";
import { Icon } from "@/components/icons";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Messages" };

export default async function InboxPage() {
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent("/inbox")}`);
  const list = await getData().listConversations(me.id);
  return (
    <div className="narrow">
      <AppBar title="Messages" />
      <div className="pad stack">
        {list.length === 0 ? (
          <EmptyState icon="msg" title="Aucune conversation" action={<Link className="btn btn-secondary" href="/">Voir les annonces</Link>}>
            Ouvre une annonce et écris au vendeur pour poser une question ou convenir d&apos;un lieu de remise.
          </EmptyState>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {list.map((c) => (
              <li key={c.id}>
                <Link href={`/inbox/${c.id}`} className="row row-link">
                  <span className="lead" style={{ minWidth: 0, flex: 1 }}>
                    <Avatar name={c.counterpart.displayName} />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.counterpart.displayName}</strong>
                      <span className="hint" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.itemTitle}</span>
                      <span className="muted" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.lastMessage ?? "Pas encore de message"}</span>
                    </span>
                  </span>
                  {c.unread > 0 ? <span className="chip" aria-label={`${c.unread} non lu${c.unread > 1 ? "s" : ""}`}>{c.unread}</span> : <Icon name="chev" />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
