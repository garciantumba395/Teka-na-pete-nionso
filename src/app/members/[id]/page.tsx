import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { AppBar, Avatar, EmptyState, ListingCard, Stars } from "@/components/ui";
import Link from "next/link";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getData().getPublicProfile((await params).id);
  return { title: p ? p.displayName : "Membre introuvable" };
}

export default async function MemberPage({ params }: Props) {
  const { id } = await params;
  const data = getData();
  const profile = await data.getPublicProfile(id);
  if (!profile) notFound();
  const me = await currentUser();
  const [items, areas, reviews] = await Promise.all([data.listItems({ sellerId: id, includeSold: true }), data.listAreas(), data.listReviews(id)]);
  const area = areas.find((a) => a.id === profile.areaId);
  return (
    <div style={{ maxWidth: "var(--layout-content-max)", margin: "0 auto" }}>
      <AppBar title="Profil" back="/" />
      <div className="page">
        <div className="seller" style={{ padding: 0 }}>
          <Avatar name={profile.displayName} size={72} />
          <div className="who">
            <h1 className="h1" style={{ overflowWrap: "anywhere" }}>{profile.displayName}</h1>
            <Stars value={profile.ratingAvg} count={profile.ratingCount} />
            {area && <div className="hint"><Icon name="pin" size={14} /> {area.name}</div>}
            {profile.verificationLevel !== "none" && <div className="hint"><Icon name="shield" size={14} /> Numéro de téléphone vérifié</div>}
          </div>
        </div>
        {profile.bio && <p style={{ margin: 0, overflowWrap: "anywhere" }}>{profile.bio}</p>}
        {me && me.id !== id && <Link href={`/report?type=user&id=${id}`} className="btn btn-ghost" style={{ justifySelf: "start" }}>Signaler ce membre</Link>}
        <section aria-labelledby="their-reviews" className="stack">
          <h2 id="their-reviews" className="h2">Avis ({reviews.length})</h2>
          {reviews.length === 0 ? <p className="hint" style={{ margin: 0 }}>Aucun avis pour l&apos;instant.</p> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-12)" }}>
              {reviews.map((r) => (
                <li key={r.id} className="stack" style={{ gap: 2 }}>
                  <span><strong>{r.authorName}</strong> · <span className="tnum">{r.rating} / 5</span></span>
                  {r.comment && <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.comment}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="their-items">
          <h2 id="their-items" className="h2" style={{ marginBottom: "var(--space-12)" }}>Annonces</h2>
          {items.length === 0 ? (
            <EmptyState title="Aucune annonce en ce moment">Reviens plus tard.</EmptyState>
          ) : (
            <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {items.map((it) => <li key={it.id}><ListingCard item={it} /></li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
