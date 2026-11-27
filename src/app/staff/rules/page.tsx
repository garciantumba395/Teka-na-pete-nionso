import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AppBar, Banner } from "@/components/ui";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Règles d'articles interdits" };
export const dynamic = "force-dynamic";

export default async function StaffRulesPage() {
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent("/staff/rules")}`);
  if (!["moderator", "support", "admin"].includes(me.role ?? "member")) notFound();
  const rules = await getData().listProhibitedRules();
  return (
    <div className="narrow-wide" style={{ maxWidth: "var(--layout-content-max)", margin: "0 auto" }}>
      <AppBar title="Articles interdits" back="/staff" />
      <div className="page stack">
        <Banner kind="warn" title="Liste à faire valider par un juriste local">
          Ce catalogue est une base de travail prudente. Avant le lancement public, un juriste de RDC doit le relire (armes, stupéfiants, médicaments,
          faune protégée, minerais, documents officiels). Les règles se modifient dans la table prohibited_rules, sans redéployer (cache de 30 secondes).
        </Banner>
        <p className="muted" style={{ margin: 0 }}>
          {rules.length} règles actives. Les mots-clés ne sont jamais affichés, ni ici ni dans les refus. Aucun rôle ne peut publier malgré un refus.
        </p>
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {rules.map((r) => (
            <li key={r.id} style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
              <strong>{r.label}</strong> <span className="hint">({r.id})</span>
              <p className="muted" style={{ margin: "var(--space-8) 0 0" }}>{r.message}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
