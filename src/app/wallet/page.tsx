import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PayoutForm, PayoutsLive } from "@/components/client/PayoutForm";
import { AppBar, EmptyState } from "@/components/ui";
import { PAYMENT_METHODS } from "@/lib/copy";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Portefeuille" };

const PAYOUT_LABEL: Record<string, string> = {
  requested: "Demandé", processing: "En cours", paid: "Reçu", failed: "Échoué", cancelled: "Annulé",
};
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function WalletPage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/wallet");
  const data = getData();
  const [wallet, payouts] = await Promise.all([data.getWallet(me.id), data.listPayouts(me.id)]);
  const inProgress = payouts.some((p) => p.status === "requested" || p.status === "processing");

  return (
    <div className="narrow">
      <AppBar title="Portefeuille" back="/me" />
      <PayoutsLive active={inProgress} />
      <div className="pad stack-lg">
        <section aria-labelledby="balance" className="stack">
          <h2 id="balance" className="h2">Solde</h2>
          {wallet.balances.length === 0 ? (
            <EmptyState icon="info" title="Ton solde est vide">Il augmente dès qu&apos;une vente est confirmée avec le code de remise.</EmptyState>
          ) : (
            wallet.balances.map((b) => (
              <div key={b.currency} style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
                <span className="hint">Disponible en {b.currency}</span>
                <div className="price tnum" style={{ fontSize: 32, lineHeight: "38px" }} data-testid={`balance-${b.currency}`}>{formatMoney(b.availableMinor, b.currency)}</div>
                {b.pendingMinor > 0 && <span className="hint">{formatMoney(b.pendingMinor, b.currency)} en cours de retrait</span>}
              </div>
            ))
          )}
        </section>

        <section aria-labelledby="withdraw" className="stack">
          <h2 id="withdraw" className="h2">Retirer mon argent</h2>
          <PayoutForm balances={wallet.balances} defaultPhone={me.phone.replace(/^\+243/, "")} />
        </section>

        {payouts.length > 0 && (
          <section aria-labelledby="payouts" className="stack">
            <h2 id="payouts" className="h2">Mes retraits</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {payouts.map((p) => (
                <li key={p.id} className="row" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <span>
                    <strong className="tnum">{formatMoney(p.amountMinor, p.currency)}</strong>
                    <span className="hint" style={{ display: "block" }}>{PAYMENT_METHODS.find((m) => m.value === p.method)?.label} · {dateFmt.format(p.requestedAt)}</span>
                  </span>
                  <span className={`chip`} aria-pressed={p.status === "paid"} style={{ cursor: "default" }}>{PAYOUT_LABEL[p.status]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {wallet.entries.length > 0 && (
          <section aria-labelledby="history" className="stack">
            <h2 id="history" className="h2">Historique</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {wallet.entries.map((e) => (
                <li key={e.id} className="row" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <span><strong>{e.label}</strong><span className="hint" style={{ display: "block" }}>{dateFmt.format(e.at)}</span></span>
                  <span className="tnum" style={{ fontWeight: 700, color: e.amountMinor >= 0 ? "var(--color-success)" : "var(--color-text)" }}>
                    {e.amountMinor >= 0 ? "+" : ""}{formatMoney(e.amountMinor, e.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
