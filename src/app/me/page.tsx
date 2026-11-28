import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/client/LogoutButton";
import { Icon } from "@/components/icons";
import { AppBar, Avatar, EmptyState, Stars } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/copy";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Mon profil" };

export default async function MePage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/me");
  const orders = await getData().listMyOrders(me.id);
  const unread = await getData().countUnreadNotifications(me.id);
  return (
    <div className="narrow">
      <AppBar title="Mon profil" />
      <div className="pad stack-lg">
        <div className="seller" style={{ padding: 0 }}>
          <Avatar name={me.displayName} size={56} />
          <div className="who"><strong style={{ fontSize: "var(--text-lg-size)" }}>{me.displayName}</strong><Stars value={me.ratingAvg} count={me.ratingCount} /></div>
        </div>

        <nav aria-label="Mon compte">
          <Link href="/notifications" className="row row-link">
            <span className="lead"><Icon name="bell" /> Notifications</span>
            {unread > 0 ? <><span className="pastille" aria-hidden="true">{unread}</span><span className="sr-only">{`${unread} non lue${unread > 1 ? "s" : ""}`}</span></> : <Icon name="chev" />}
          </Link>
          <Link href="/wallet" className="row row-link"><span className="lead"><Icon name="wallet" /> Portefeuille</span><Icon name="chev" /></Link>
          <Link href="/sell" className="row row-link"><span className="lead"><Icon name="plus" /> Vendre un article</span><Icon name="chev" /></Link>
          <Link href="/favourites" className="row row-link"><span className="lead"><Icon name="heart" /> Favoris</span><Icon name="chev" /></Link>
          <Link href="/me/preferences" className="row row-link"><span className="lead"><Icon name="search" /> Mes préférences (marques et tailles)</span><Icon name="chev" /></Link>
          {["moderator", "support", "admin"].includes(me.role ?? "member") && <Link href="/staff" className="row row-link"><span className="lead"><Icon name="shield" /> Assistance</span><Icon name="chev" /></Link>}
          <Link href={`/members/${me.id}`} className="row row-link"><span className="lead"><Icon name="user" /> Mon profil public</span><Icon name="chev" /></Link>
        </nav>

        <section aria-labelledby="orders" className="stack">
          <h2 id="orders" className="h2">Mes commandes</h2>
          {orders.length === 0 ? (
            <EmptyState icon="info" title="Aucune commande" action={<Link className="btn btn-secondary" href="/">Voir les annonces</Link>}>
              Tes achats et tes ventes apparaîtront ici.
            </EmptyState>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="row row-link">
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.items[0]?.title ?? "Commande"}</strong>
                      <span className="hint">{o.viewerRole === "buyer" ? "Achat" : "Vente"} · {ORDER_STATUS_LABEL[o.status]}</span>
                    </span>
                    <span className="price tnum">{formatMoney(o.viewerRole === "buyer" ? o.totalMinor : o.itemsMinor, o.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <LogoutButton />
      </div>
    </div>
  );
}
