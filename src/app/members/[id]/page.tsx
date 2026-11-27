import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { AppBar, Avatar, EmptyState, ListingCard, Stars } from "@/components/ui";
import { getData } from "@/lib/data";

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
  const [items, areas] = await Promise.all([data.listItems({ sellerId: id, includeSold: true }), data.listAreas()]);
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
