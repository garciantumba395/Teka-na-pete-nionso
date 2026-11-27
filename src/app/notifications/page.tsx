import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationList, type NotificationRow } from "@/components/client/NotificationList";
import { AppBar, EmptyState } from "@/components/ui";
import { getData } from "@/lib/data";
import { describeNotification } from "@/lib/notifications";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Notifications" };

// Heures en fuseau fixe : le serveur formate, le navigateur reçoit du texte (aucun écart d'hydratation possible).
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });

export default async function NotificationsPage() {
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent("/notifications")}`);
  const { items, unreadCount } = await getData().listNotifications(me.id);
  const rows: NotificationRow[] = items.map((n) => ({ id: n.id, read: n.read, dateLabel: dateFmt.format(n.createdAt), ...describeNotification(n) }));
  return (
    <div className="narrow">
      <AppBar title="Notifications" back="/me" />
      <div className="pad stack">
        {rows.length === 0 ? (
          <EmptyState icon="bell" title="Aucune notification">
            Tu seras prévenu ici d&apos;un nouveau message, d&apos;une commande payée, d&apos;un litige ou d&apos;un avis.
          </EmptyState>
        ) : (
          <NotificationList rows={rows} unreadCount={unreadCount} />
        )}
        <Link className="btn btn-ghost" href="/me/notifications">Régler les SMS</Link>
      </div>
    </div>
  );
}
