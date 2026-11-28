import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CourierModeForm, SettleCourierButton } from "@/components/client/CourierFees";
import { AppBar, Banner, EmptyState } from "@/components/ui";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Frais de livraison à régler" };
export const dynamic = "force-dynamic";

export default async function StaffCourierFeesPage() {
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent("/staff/courier-fees")}`);
  if (!["support", "admin"].includes(me.role ?? "member")) notFound();
  const data = getData();
  const [dues, mode] = await Promise.all([data.listCourierDues(me.id), data.getCourierFeeMode()]);
  return (
    <div className="narrow-wide" style={{ maxWidth: "var(--layout-content-max)", margin: "0 auto" }}>
      <AppBar title="Frais de livraison" back="/staff" />
      <div className="page stack">
        {mode === "seller" ? (
          <Banner kind="info" title="Mode actuel : le vendeur règle le coursier">
            Les frais de livraison sont versés au vendeur à la libération de la commande. Rien n&apos;est à régler ici, sauf les frais d&apos;anciennes commandes
            libérées quand la plateforme réglait le coursier.
          </Banner>
        ) : (
          <Banner kind="warn" title="Mode actuel : la plateforme règle le coursier">
            Les frais de livraison restent en attente à la libération. Paie le coursier, puis marque la commande comme réglée.
          </Banner>
        )}
        <section className="stack" aria-labelledby="dues-title">
          <h2 id="dues-title" className="h2">Frais à régler au coursier ({dues.length})</h2>
          {dues.length === 0 ? <EmptyState icon="check" title="Aucun frais de livraison en attente" /> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-16)" }}>
              {dues.map((d) => (
                <li key={d.orderId} data-testid="courier-due" data-order-id={d.orderId} className="stack" style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{d.itemTitle}</strong>
                  <span className="price tnum">{formatMoney(d.amountMinor, d.currency)}</span>
                  <span className="hint" style={{ overflowWrap: "anywhere" }}>
                    Coursier : {d.courierName ?? "non précisé"}{d.courierPhone ? ` · ${d.courierPhone}` : ""}
                  </span>
                  <SettleCourierButton orderId={d.orderId} label={d.itemTitle} />
                </li>
              ))}
            </ul>
          )}
        </section>
        {me.role === "admin" && <CourierModeForm mode={mode} />}
      </div>
    </div>
  );
}
