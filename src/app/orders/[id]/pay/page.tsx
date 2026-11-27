import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PayForm } from "@/components/client/PayForm";
import { AppBar } from "@/components/ui";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { currentUser } from "@/lib/session";
import { isAppError } from "@/lib/types";

export const metadata: Metadata = { title: "Paiement" };

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/orders/${id}/pay`)}`);
  const data = getData();
  let order;
  try {
    order = await data.getOrder(id, me.id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  if (order.viewerRole !== "buyer" || order.status !== "pending_payment") redirect(`/orders/${id}`);
  const pay = await data.getPayment(id, me.id);
  const pending = pay?.status === "pending_user" || pay?.status === "initiated";

  return (
    <div className="narrow">
      <AppBar title="Paiement" back={`/items/${order.items[0]?.id ?? ""}`} />
      <div className="pad stack-lg">
        <section className="stack" aria-labelledby="recap">
          <h2 id="recap" className="h2">Ta commande</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {order.items.map((it) => (
              <li key={it.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {it.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.photo} alt="" width={56} height={72} style={{ objectFit: "cover", borderRadius: "var(--radius-sm)" }} />
                ) : null}
                <span style={{ flex: 1, overflowWrap: "anywhere" }}>{it.title}</span>
                <span className="price tnum">{formatMoney(it.priceMinor, it.currency)}</span>
              </li>
            ))}
          </ul>
          <dl className="kv">
            <dt>Articles</dt><dd className="tnum">{formatMoney(order.itemsMinor, order.currency)}</dd>
            {order.shippingMinor > 0 && <><dt>Livraison</dt><dd className="tnum">{formatMoney(order.shippingMinor, order.currency)}</dd></>}
            <dt>Protection acheteur</dt><dd className="tnum">{formatMoney(order.protectionFeeMinor, order.currency)}</dd>
            <dt className="total">Total</dt><dd className="total tnum">{formatMoney(order.totalMinor, order.currency)}</dd>
          </dl>
          <p className="hint" style={{ margin: 0 }}>
            Vendeur : <strong>{order.counterpart.displayName}</strong>. Remise en main propre : l&apos;argent reste bloqué jusqu&apos;à la remise de l&apos;article.
          </p>
        </section>

        <PayForm
          orderId={id}
          totalLabel={formatMoney(order.totalMinor, order.currency)}
          defaultPhone={me.phone.replace(/^\+243/, "")}
          expiresAt={order.paymentExpiresAt ?? Date.now()}
          initialPending={pending}
        />
      </div>
    </div>
  );
}
