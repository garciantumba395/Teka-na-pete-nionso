import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReportActions } from "@/components/client/ReportForm";
import { AppBar, EmptyState } from "@/components/ui";
import { DISPUTE_REASONS, REPORT_REASONS } from "@/lib/copy";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Assistance" };

export default async function StaffPage() {
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent("/staff")}`);
  if (!["moderator", "support", "admin"].includes(me.role ?? "member")) notFound();
  const data = getData();
  const canDispute = ["support", "admin"].includes(me.role ?? "member");
  const [reports, disputes] = await Promise.all([data.listReports(me.id), canDispute ? data.listOpenDisputes(me.id) : Promise.resolve([])]);
  return (
    <div className="narrow-wide" style={{ maxWidth: "var(--layout-content-max)", margin: "0 auto" }}>
      <AppBar title="Assistance" back="/me" />
      <div className="page">
        {canDispute && (
          <section className="stack" aria-labelledby="disputes">
            <h2 id="disputes" className="h2">Litiges ouverts ({disputes.length})</h2>
            {disputes.length === 0 ? <EmptyState icon="check" title="Aucun litige ouvert" /> : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {disputes.map((d) => (
                  <li key={d.id}>
                    <Link href={`/staff/disputes/${d.id}`} className="row row-link">
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.itemTitle}</strong>
                        <span className="hint">{DISPUTE_REASONS.find((r) => r.value === d.reason)?.label}</span>
                      </span>
                      <span className="price tnum">{formatMoney(d.totalMinor, d.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className="stack" aria-labelledby="reports">
          <h2 id="reports" className="h2">Signalements à traiter ({reports.length})</h2>
          {reports.length === 0 ? <EmptyState icon="check" title="Aucun signalement" /> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-16)" }}>
              {reports.map((r) => (
                <li key={r.id} className="stack" style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{r.targetType === "item" ? "Annonce" : "Membre"} : {r.targetLabel}</strong>
                  <span className="hint">{REPORT_REASONS.find((x) => x.value === r.reason)?.label} · signalé par {r.reporterName}</span>
                  {r.details && <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.details}</p>}
                  <ReportActions reportId={r.id} canHide={r.targetType === "item"} />
                </li>
              ))}
            </ul>
          )}
        </section>
        {canDispute && <p><Link href="/staff/courier-fees">Frais de livraison à régler</Link></p>}
        <p><Link href="/staff/rules">Règles d&apos;articles interdits</Link></p>
      </div>
    </div>
  );
}
