import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BuyerCancelRequest, SellerCancelRequest } from "@/components/client/CancelRequest";
import { CancelOrder, ConfirmCodeForm, HandoverCodeCard, OrderLive } from "@/components/client/OrderPanels";
import { Avatar, AppBar, Banner, OrderStepper } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/copy";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { currentUser } from "@/lib/session";
import { isAppError } from "@/lib/types";

export const metadata: Metadata = { title: "Commande" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/orders/${id}`)}`);
  let order;
  try {
    order = await getData().getOrder(id, me.id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  const buyer = order.viewerRole === "buyer";
  const a = (x: string) => order.actions.includes(x as never);

  return (
    <div className="narrow">
      <AppBar title="Commande" back="/me" />
      <OrderLive orderId={id} status={order.status} />
      <div className="pad stack-lg">
        <div className="stack">
          <span className="chip" style={{ justifySelf: "start", cursor: "default" }}>
            {ORDER_STATUS_LABEL[order.status] ?? order.status}
          </span>
          <OrderStepper status={order.status} />
        </div>

        {order.status === "pending_payment" && buyer && (
          <div className="stack">
            <Banner kind="warn" title="Paiement en attente">L&apos;article est réservé pour toi quelques minutes.</Banner>
            <Link className="btn btn-primary btn-lg" href={`/orders/${id}/pay`}>Payer {formatMoney(order.totalMinor, order.currency)}</Link>
            <CancelOrder orderId={id} intro="L'article redeviendra disponible pour les autres acheteurs." confirmLabel="Oui, annuler" />
          </div>
        )}
        {order.status === "pending_payment" && !buyer && (
          <Banner kind="info" title="L'acheteur n'a pas encore payé">Tu seras prévenu dès que le paiement est validé. Ne remets rien avant.</Banner>
        )}

        {buyer && a("reveal_code") && (
          <>
            <Banner kind="ok" title="Paiement reçu">Ton argent est bloqué en sécurité. Retrouve {order.counterpart.displayName} pour la remise.</Banner>
            <HandoverCodeCard orderId={id} />
            <BuyerCancelRequest orderId={id} request={order.cancelRequest} canRequest={a("request_cancel")} canWithdraw={a("withdraw_cancel")} />
            <Link className="btn btn-ghost" href={`/orders/${id}/dispute`}>J&apos;ai un problème</Link>
          </>
        )}

        {!buyer && a("confirm_delivery") && (
          <>
            <Banner kind="ok" title="Paiement reçu">L&apos;argent est bloqué en sécurité. Remets l&apos;article à {order.counterpart.displayName}.</Banner>
            <SellerCancelRequest orderId={id} request={order.cancelRequest} canAnswer={a("accept_cancel")} />
            <ConfirmCodeForm orderId={id} attemptsLeft={order.handover?.attemptsLeft ?? 5} lockedUntil={order.handover?.lockedUntil ?? null} />
            <CancelOrder orderId={id} intro="L'acheteur sera remboursé en totalité et l'article remis en vente." confirmLabel="Oui, annuler la vente" />
            <Link className="btn btn-ghost" href={`/orders/${id}/dispute`}>J&apos;ai un problème</Link>
          </>
        )}

        {order.status === "disputed" && (
          <div className="stack">
            <Banner kind="warn" title="Litige en cours">L&apos;argent reste bloqué le temps que l&apos;assistance examine la situation.</Banner>
            <Link className="btn btn-primary" href={`/orders/${id}/dispute`}>Voir le litige</Link>
          </div>
        )}
        {order.status === "completed" && (
          <Banner kind="ok" title={buyer ? "Article reçu" : "Vente terminée"}>
            {buyer ? "Merci ! Le vendeur a reçu l'argent." : <>L&apos;argent est dans ton <Link href="/wallet">portefeuille</Link>.</>}
          </Banner>
        )}
        {order.status === "completed" && a("review") && (
          <Link className="btn btn-secondary" href={`/orders/${id}/review`}>Donner mon avis sur {order.counterpart.displayName}</Link>
        )}
        {(order.status === "cancelled" || order.status === "refunded") && (
          <Banner kind="info" title={order.dispute?.status === "resolved_refund" ? "Litige clos : tu as été remboursé" : "Commande annulée"}>
            {order.cancelRequest?.status === "accepted"
              ? buyer ? "Le vendeur a accepté ta demande. Tu as été remboursé en totalité." : "Tu as accepté la demande de l'acheteur : il a été remboursé et l'article est remis en vente."
              : buyer && order.paidAt ? "Tu as été remboursé en totalité." : "Aucun paiement n'a été retenu."}
          </Banner>
        )}
        {order.status === "expired" && (
          <Banner kind="warn" title="Délai de paiement dépassé">
            L&apos;article a été remis en vente. {order.payment?.status === "refunded" ? "Un paiement reçu en retard t'a été remboursé." : ""}{" "}
            {buyer && order.items[0] ? <Link href={`/items/${order.items[0].id}`}>Revoir l&apos;annonce</Link> : null}
          </Banner>
        )}

        <section className="stack" aria-labelledby="detail">
          <h2 id="detail" className="h2">Détail</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {order.items.map((it) => (
              <li key={it.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {it.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.photo} alt="" width={56} height={72} style={{ objectFit: "cover", borderRadius: "var(--radius-sm)" }} />
                ) : null}
                <Link href={`/items/${it.id}`} style={{ flex: 1, overflowWrap: "anywhere" }}>{it.title}</Link>
                <span className="price tnum">{formatMoney(it.priceMinor, it.currency)}</span>
              </li>
            ))}
          </ul>
          <dl className="kv">
            <dt>Articles</dt><dd className="tnum">{formatMoney(order.itemsMinor, order.currency)}</dd>
            {buyer && <><dt>Protection acheteur</dt><dd className="tnum">{formatMoney(order.protectionFeeMinor, order.currency)}</dd></>}
            <dt className="total">{buyer ? "Total payé" : "Tu reçois"}</dt>
            <dd className="total tnum">{formatMoney(buyer ? order.totalMinor : order.itemsMinor, order.currency)}</dd>
          </dl>
        </section>

        <Link href={`/members/${order.counterpart.id}`} className="seller row-link" style={{ padding: 0, color: "inherit", textDecoration: "none" }}>
          <Avatar name={order.counterpart.displayName} />
          <div className="who"><span className="hint">{buyer ? "Vendeur" : "Acheteur"}</span><strong>{order.counterpart.displayName}</strong></div>
        </Link>
      </div>
    </div>
  );
}
