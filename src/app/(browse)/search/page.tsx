import type { Metadata } from "next";
import Link from "next/link";
import { AppBar, EmptyState, ListingCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { getData } from "@/lib/data";

export const metadata: Metadata = { title: "Chercher" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const category = one(sp.category);
  const area = one(sp.area);
  const radius = Number(one(sp.radius)) || 0;
  const maxUsd = Number(one(sp.max)) || 0;

  const data = getData();
  const [cats, communes, items] = await Promise.all([
    data.listCategories(),
    data.listAreas("area-prov-kinshasa"),
    data.listItems({
      q: q || undefined,
      categoryId: category || undefined,
      areaId: area || undefined,
      radiusKm: area && radius ? radius : undefined,
      maxPriceUsdMinor: maxUsd ? Math.round(maxUsd * 100) : undefined,
      limit: 60,
    }),
  ]);
  const parents = cats.filter((c) => c.parentId === null);
  const hasFilters = !!(q || category || area || maxUsd);
  const activeCat = cats.find((c) => c.id === category);
  const activeArea = communes.find((c) => c.id === area);

  const without = (key: string) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { q, category, area, radius: radius ? String(radius) : "", max: maxUsd ? String(maxUsd) : "" };
    for (const [k, v] of Object.entries(cur)) if (v && k !== key && !(key === "area" && k === "radius")) p.set(k, v);
    return `/search?${p.toString()}`;
  };

  return (
    <div className="narrow-wide" style={{ maxWidth: "var(--layout-content-max)", margin: "0 auto" }}>
      <AppBar title="Chercher" back="/" />
      <div className="page">
        <form action="/search" className="stack" aria-label="Filtres de recherche">
          <label className="search">
            <Icon name="search" />
            <input name="q" type="search" defaultValue={q} aria-label="Mot-clé" placeholder="Chercher un article" enterKeyHint="search" />
          </label>
          <div style={{ display: "grid", gap: "var(--space-8)", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <div className="field">
              <label htmlFor="category">Catégorie</label>
              <select id="category" name="category" className="input" defaultValue={category}>
                <option value="">Toutes</option>
                {parents.map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    <option value={p.id}>Tout : {p.name}</option>
                    {cats.filter((c) => c.parentId === p.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="area">Autour de</label>
              <select id="area" name="area" className="input" defaultValue={area}>
                <option value="">Partout</option>
                {communes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="radius">Rayon</label>
              <select id="radius" name="radius" className="input" defaultValue={String(radius || 10)}>
                {[3, 5, 10, 25].map((r) => <option key={r} value={r}>{r} km</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="max">Prix max (USD)</label>
              <input id="max" name="max" className="input tnum" inputMode="decimal" defaultValue={maxUsd || ""} placeholder="Sans limite" />
            </div>
          </div>
          <button className="btn btn-primary" type="submit">Rechercher</button>
        </form>

        {hasFilters && (
          <div className="chips" aria-label="Filtres actifs">
            {q && <Link className="chip" href={without("q")} aria-label={`Retirer le mot-clé ${q}`}>« {q} » <Icon name="x" size={16} /></Link>}
            {activeCat && <Link className="chip" href={without("category")} aria-label={`Retirer la catégorie ${activeCat.name}`}>{activeCat.name} <Icon name="x" size={16} /></Link>}
            {activeArea && <Link className="chip" href={without("area")} aria-label={`Retirer le lieu ${activeArea.name}`}>{activeArea.name}{radius ? `, ${radius} km` : ""} <Icon name="x" size={16} /></Link>}
            {maxUsd > 0 && <Link className="chip" href={without("max")} aria-label="Retirer le prix maximum">≤ {maxUsd} $ <Icon name="x" size={16} /></Link>}
          </div>
        )}

        <p role="status" aria-live="polite" className="muted" style={{ margin: 0 }}>
          {items.length} résultat{items.length > 1 ? "s" : ""}
        </p>

        {items.length === 0 ? (
          <EmptyState title="Aucun résultat" action={hasFilters ? <Link className="btn btn-secondary" href="/search">Effacer les filtres</Link> : undefined}>
            Essaie d&apos;élargir le rayon ou de retirer un filtre.
          </EmptyState>
        ) : (
          <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((it) => (
              <li key={it.id}><ListingCard item={it} showDistance={!!(area && radius)} /></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
