import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotificationPrefs } from "@/components/client/NotificationPrefs";
import { AppBar, Banner } from "@/components/ui";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Réglages des notifications" };

export default async function NotificationSettingsPage() {
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent("/me/notifications")}`);
  const prefs = await getData().getNotificationPreferences(me.id);
  return (
    <div className="narrow">
      <AppBar title="Réglages des notifications" back="/notifications" />
      <div className="pad stack-lg">
        <Banner kind="info" title="Les notifications dans l'application restent toujours actives">
          Tu les retrouves dans l&apos;onglet Notifications. Tu peux seulement choisir de recevoir ou non un SMS pour les événements importants. Les SMS ne contiennent ni code de remise ni montant.
        </Banner>
        <NotificationPrefs initial={prefs} />
      </div>
    </div>
  );
}
