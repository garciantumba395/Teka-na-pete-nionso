import Link from "next/link";
import { EmptyState, ListingCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { getData } from "@/lib/data";
import { APP_NAME } from "@/lib/copy";

export default async function HomePage() {
  const data = getData();
  const [cats, items] = await Promise.all([data.listCategories(), data.listItems({ limit: 24 })]);
  const top = cats.filter((c) => c.parentId === null);
  return (
    <div className="page">
      <form action="/search" role="search" className="search" aria-label={`Rechercher sur ${APP_NAME}`}>
        <Icon name="search" />
        <input name="q" type="search" aria-label="Rechercher un article" placeholder="Chercher un article" enterKeyHint="search" />
      </form>

      <nav aria-label="Catégories" className="chips">
        {top.map((c) => (
          <Link key={c.id} className="chip" href={`/search?category=${c.id}`}>{c.name}</Link>
        ))}
        <Link className="chip" href="/search?area=area-com-gombe&radius=10">Près de moi</Link>
      </nav>

      <section aria-labelledby="latest">
        <h1 id="latest" className="h2" style={{ marginBottom: "var(--space-12)" }}>Dernières annonces</h1>
        {items.length === 0 ? (
          <EmptyState title="Aucune annonce pour l'instant" action={<Link className="btn btn-primary" href="/sell">Vendre un article</Link>}>
            Sois le premier à publier près de chez toi.
          </EmptyState>
        ) : (
          <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((it) => (
              <li key={it.id}><ListingCard item={it} /></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
