import type { Metadata } from "next";
import Link from "next/link";
import { AppBar } from "@/components/ui";
import { getData } from "@/lib/data";

export const metadata: Metadata = { title: "Ce qu'on ne peut pas vendre", description: "La liste des articles interdits à la vente sur la plateforme." };
export const dynamic = "force-dynamic"; // les règles se modifient en base, sans redéployer

export default async function Page() {
  const rules = await getData().listProhibitedRules();
  return (
    <div className="narrow">
      <AppBar title="Ce qu'on ne peut pas vendre" back="/sell" />
      <div className="pad stack">
        <p style={{ margin: 0 }}>
          Pour protéger les acheteurs comme les vendeurs, certains articles ne peuvent pas être publiés. Une annonce qui en mentionne un dans son titre, sa
          description ou sa marque est refusée et reste en brouillon : rien n&apos;est mis en ligne.
        </p>
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Articles interdits">
          {rules.map((r) => (
            <li key={r.id} id={r.id} style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
              <h2 className="h2" style={{ margin: 0 }}>{r.label}</h2>
              <p className="muted" style={{ margin: "var(--space-8) 0 0" }}>{r.message}</p>
            </li>
          ))}
        </ul>
        <p className="hint" style={{ margin: 0 }}>
          Un doute sur un article ? Mieux vaut ne pas le publier. Tu peux aussi signaler une annonce qui ne respecte pas ces règles depuis sa fiche.
          Cette liste évolue : elle n&apos;est pas exhaustive.
        </p>
        <Link className="btn btn-secondary" href="/sell">Retour au formulaire de vente</Link>
      </div>
    </div>
  );
}
