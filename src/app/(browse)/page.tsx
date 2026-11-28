import Link from "next/link";
import { EmptyState, ListingCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { getData } from "@/lib/data";
import { seedId } from "@/lib/data/ids";
import { APP_NAME } from "@/lib/copy";
import { currentUser } from "@/lib/session";

export default async function HomePage() {
  const data = getData();
  const me = await currentUser();
  // agent H : « Pour toi » (membre connecté seulement, l'accueil du visiteur est inchangé) ; la liste générale n'en répète aucune annonce.
  const [cats, general, follows, forYou] = await Promise.all([
    data.listCategories(),
    data.listItems({ limit: 36, viewerId: me?.id ?? null }),
    me ? data.getFollows(me.id) : null,
    me ? data.listForYou(me.id) : [],
  ]);
  const seen = new Set(forYou.map((i) => i.id));
  const items = general.filter((i) => !seen.has(i.id)).slice(0, 24);
  const followsNothing = !!follows && follows.brands.length + follows.sizes.length === 0;
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
        <Link className="chip" href={`/search?area=${seedId("area-com-gombe")}&radius=10`}>Près de moi</Link>
      </nav>

      {me && (
        <section aria-labelledby="for-you" className="for-you">
          <h2 id="for-you" className="h2">Pour toi</h2>
          {followsNothing ? (
            <div className="for-you-invite">
              <span>Suis des marques et des tailles pour voir ici les annonces qui te correspondent.</span>
              <Link className="btn btn-secondary" href="/me/preferences">Personnaliser mon fil</Link>
            </div>
          ) : forYou.length === 0 ? (
            <div className="for-you-invite">
              <span>Aucune annonce récente ne correspond à tes marques et à tes tailles pour l&apos;instant.</span>
              <Link className="btn btn-secondary" href="/me/preferences">Modifier mes préférences</Link>
            </div>
          ) : (
            <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {forYou.map((it) => (
                <li key={it.id}><ListingCard item={it} /></li>
              ))}
            </ul>
          )}
        </section>
      )}

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
