import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar, EmptyState, ListingCard } from "@/components/ui";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Favoris" };

// S17 : les annonces que le membre a mises en favori. Il ne voit que les siennes ; une annonce masquée ou retirée n'y figure plus.
export default async function FavouritesPage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/favourites");
  const items = await getData().listFavourites(me.id);
  return (
    <div style={{ maxWidth: "var(--layout-content-max)", margin: "0 auto" }}>
      <AppBar title="Favoris" back="/me" />
      <div className="page stack">
        <p role="status" aria-live="polite" className="muted" style={{ margin: 0 }}>
          {items.length} annonce{items.length > 1 ? "s" : ""} en favori
        </p>
        {items.length === 0 ? (
          <EmptyState icon="heart" title="Aucun favori pour l'instant" action={<Link className="btn btn-primary" href="/">Voir les annonces</Link>}>
            Touche le cœur d&apos;une annonce pour la retrouver ici.
          </EmptyState>
        ) : (
          <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((it) => (
              <li key={it.id}><ListingCard item={it} favouriteVariant="list" /></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
