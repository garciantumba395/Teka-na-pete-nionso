import { cleanLine } from "@/lib/text";
import type { Metadata } from "next";
import Link from "next/link";
import { AppBar, EmptyState, ListingCard } from "@/components/ui";
import { Icon } from "@/components/icons";
import { getData } from "@/lib/data";
import { seedId } from "@/lib/data/ids";
import { CONDITIONS } from "@/lib/validation";
import type { Condition } from "@/lib/types";

export const metadata: Metadata = { title: "Chercher" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function SearchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = cleanLine(one(sp.q)).trim();
  const category = one(sp.category);
  const area = one(sp.area);
  const radius = Number(one(sp.radius)) || 0;
  const maxUsd = Number(one(sp.max)) || 0;
  const brand = cleanLine(one(sp.brand)).trim().slice(0, 40);
  const size = cleanLine(one(sp.size)).trim().slice(0, 20);
  const rawCond = ([] as (string | undefined)[]).concat(sp.condition ?? []);
  const conditions = CONDITIONS.map((c) => c.value).filter((v): v is Condition => rawCond.includes(v));

  const data = getData();
  const [cats, communes, items] = await Promise.all([
    data.listCategories(),
    data.listAreas(seedId("area-prov-kinshasa")),
    data.listItems({
      q: q || undefined,
      categoryId: category || undefined,
      areaId: area || undefined,
      radiusKm: area && radius ? radius : undefined,
      maxPriceUsdMinor: maxUsd ? Math.round(maxUsd * 100) : undefined,
      brand: brand || undefined,
      sizeLabel: size || undefined,
      conditions: conditions.length ? conditions : undefined,
      limit: 60,
    }),
  ]);
  const parents = cats.filter((c) => c.parentId === null);
  const hasFilters = !!(q || category || area || maxUsd || brand || size || conditions.length);
  const activeCat = cats.find((c) => c.id === category);
  const activeArea = communes.find((c) => c.id === area);

  const without = (key: string) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { q, category, area, radius: radius ? String(radius) : "", max: maxUsd ? String(maxUsd) : "", brand, size };
    for (const [k, v] of Object.entries(cur)) if (v && k !== key && !(key === "area" && k === "radius")) p.set(k, v);
    if (key !== "condition") for (const c of conditions) p.append("condition", c);
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
          <div style={{ display: "grid", gap: "var(--space-8)", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))" }}>
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
            <div className="field">
              <label htmlFor="brand">Marque</label>
              <input id="brand" name="brand" className="input" maxLength={40} defaultValue={brand} placeholder="Toutes" />
            </div>
            <div className="field">
              <label htmlFor="size">Taille</label>
              <input id="size" name="size" className="input" maxLength={20} defaultValue={size} placeholder="Toutes" />
            </div>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "var(--space-8) var(--space-16)" }}>
            <legend style={{ font: "600 var(--text-sm-size)/var(--text-sm-line) var(--font-sans)", marginBottom: "var(--space-4)" }}>État</legend>
            {CONDITIONS.map((c) => (
              <label key={c.value} style={{ display: "inline-flex", gap: "var(--space-8)", alignItems: "center", minHeight: "var(--size-touch-min)" }}>
                <input type="checkbox" name="condition" value={c.value} defaultChecked={conditions.includes(c.value)} />
                {c.label}
              </label>
            ))}
          </fieldset>
          <button className="btn btn-primary" type="submit">Rechercher</button>
        </form>

        {hasFilters && (
          <div className="chips" aria-label="Filtres actifs">
            {q && <Link className="chip" href={without("q")} aria-label={`Retirer le mot-clé ${q}`}>« {q} » <Icon name="x" size={16} /></Link>}
            {activeCat && <Link className="chip" href={without("category")} aria-label={`Retirer la catégorie ${activeCat.name}`}>{activeCat.name} <Icon name="x" size={16} /></Link>}
            {activeArea && <Link className="chip" href={without("area")} aria-label={`Retirer le lieu ${activeArea.name}`}>{activeArea.name}{radius ? `, ${radius} km` : ""} <Icon name="x" size={16} /></Link>}
            {brand && <Link className="chip" href={without("brand")}>Marque : {brand} <Icon name="x" size={16} /><span className="sr-only">, retirer ce filtre</span></Link>}
            {size && <Link className="chip" href={without("size")}>Taille : {size} <Icon name="x" size={16} /><span className="sr-only">, retirer ce filtre</span></Link>}
            {conditions.length > 0 && <Link className="chip" href={without("condition")}>État : {conditions.map((c) => CONDITIONS.find((x) => x.value === c)?.label).join(", ")} <Icon name="x" size={16} /><span className="sr-only">, retirer ce filtre</span></Link>}
            {maxUsd > 0 && <Link className="chip" href={without("max")}>≤ {maxUsd} $ <Icon name="x" size={16} /><span className="sr-only">, retirer ce filtre</span></Link>}
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
