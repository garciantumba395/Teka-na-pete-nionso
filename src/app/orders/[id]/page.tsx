import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BuyerCancelRequest, SellerCancelRequest } from "@/components/client/CancelRequest";
import { AcceptButton, InTransitButton, LostButton, ReceivedButton, ShipForm } from "@/components/client/CourierPanels";
import { CancelOrder, ConfirmCodeForm, HandoverCodeCard, OrderLive } from "@/components/client/OrderPanels";
import { Avatar, AppBar, Banner, OrderStepper, ShipmentTimeline } from "@/components/ui";
import { ORDER_STATUS_LABEL } from "@/lib/copy";
import { COURIER_ORDER_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from "@/lib/copy-courier";
import { formatDateTime } from "@/lib/datetime";
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
  // ---- agent D : livraison par coursier
  const courier = order.deliveryMethod === "courier";
  const ship = order.shipment;
  const deliveryArea = courier && order.deliveryAreaId ? (await getData().listAreas()).find((x) => x.id === order.deliveryAreaId)?.name ?? null : null;
  const statusLabel = (courier && COURIER_ORDER_STATUS_LABEL[order.status]) || ORDER_STATUS_LABEL[order.status] || order.status;

  return (
    <div className="narrow">
      <AppBar title="Commande" back="/me" />
      <OrderLive orderId={id} status={order.status} shipmentStatus={ship?.status ?? null} />
      <div className="pad stack-lg">
        <div className="stack">
          <span className="chip" style={{ justifySelf: "start", cursor: "default" }}>
            {statusLabel}
          </span>
          <OrderStepper status={order.status} method={order.deliveryMethod} shipment={ship} />
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

        {courier && order.status === "paid" && (
          <>
            <Banner kind="ok" title="Paiement reçu">
              {buyer ? `Ton argent est bloqué en sécurité. ${order.counterpart.displayName} va confier le colis à un coursier.` : "L'argent est bloqué en sécurité. Confie le colis à un coursier, puis renseigne-le ci-dessous."}
            </Banner>
            {!buyer && a("ship") && <ShipForm orderId={id} />}
            {a("cancel") && <CancelOrder orderId={id} intro={buyer ? "Tu seras remboursé en totalité, frais de protection et de livraison compris." : "L'acheteur sera remboursé en totalité et l'article remis en vente."} confirmLabel={buyer ? "Oui, annuler et me faire rembourser" : "Oui, annuler la vente"} />}
            {a("issue") && <Link className="btn btn-ghost" href={`/orders/${id}/dispute`}>J&apos;ai un problème</Link>}
          </>
        )}
        {courier && order.status === "in_delivery" && ship && (
          <>
            <Banner kind="info" title={ship.status === "in_transit" ? "Colis en route" : "Colis remis au coursier"}>
              {buyer ? "Quand tu reçois le colis, confirme-le ici. Tu auras ensuite un délai pour vérifier l'article et signaler un problème." : "L'acheteur confirmera la réception du colis."}
            </Banner>
            <section className="stack" aria-labelledby="courier-title" style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
              <h2 id="courier-title" className="h2">Coursier</h2>
              <dl className="kv">
                <dt>Nom</dt><dd>{ship.courierName}</dd>
                <dt>Téléphone</dt><dd>{ship.courierPhone ? <a href={`tel:${ship.courierPhone}`}>{ship.courierPhone}</a> : "Non renseigné"}</dd>
                <dt>Référence de suivi</dt><dd>{ship.trackingRef ?? "Aucune"}</dd>
                <dt>État du colis</dt><dd>{SHIPMENT_STATUS_LABEL[ship.status] ?? ship.status}</dd>
              </dl>
            </section>
            {buyer && a("confirm_received") && <ReceivedButton orderId={id} />}
            {!buyer && a("mark_in_transit") && <InTransitButton orderId={id} />}
            {a("report_lost") && <LostButton orderId={id} role={order.viewerRole} />}
            {a("issue") && <Link className="btn btn-ghost" href={`/orders/${id}/dispute`}>J&apos;ai un problème</Link>}
          </>
        )}
        {courier && order.status === "delivered" && (
          <>
            {buyer ? (
              <Banner kind="ok" title="Colis reçu">
                Vérifie l&apos;article. Tu peux signaler un problème jusqu&apos;au {order.autoReleaseAt ? formatDateTime(order.autoReleaseAt) : "terme du délai"}. Sans litige de ta part, l&apos;argent est libéré automatiquement au vendeur à cette date.
              </Banner>
            ) : (
              <Banner kind="info" title="Colis reçu par l'acheteur">
                L&apos;argent te sera versé dès que l&apos;acheteur accepte, ou automatiquement le {order.autoReleaseAt ? formatDateTime(order.autoReleaseAt) : "à la fin du délai"} s&apos;il n&apos;ouvre pas de litige.
              </Banner>
            )}
            {buyer && a("accept") && <AcceptButton orderId={id} />}
            {buyer && a("issue") && <Link className="btn btn-ghost" href={`/orders/${id}/dispute`}>J&apos;ai un problème</Link>}
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
          <h2 id="detail" className="h2">{order.items.length > 1 ? `Détail du lot (${order.items.length} articles)` : "Détail"}</h2>
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
            {buyer && order.shippingMinor > 0 && <><dt>Livraison</dt><dd className="tnum">{formatMoney(order.shippingMinor, order.currency)}</dd></>}
            {buyer && <><dt>Protection acheteur</dt><dd className="tnum">{formatMoney(order.protectionFeeMinor, order.currency)}</dd></>}
            {!buyer && order.shippingMinor > 0 && order.shippingToSellerMinor > 0 && (
              <><dt>Frais de livraison à remettre au coursier</dt><dd className="tnum" data-testid="seller-shipping">{formatMoney(order.shippingToSellerMinor, order.currency)}</dd></>
            )}
            {!buyer && order.shippingMinor > 0 && order.shippingToSellerMinor === 0 && order.status !== "cancelled" && order.status !== "refunded" && order.status !== "expired" && (
              <><dt>Livraison</dt><dd data-testid="seller-shipping-platform">Réglée par la plateforme</dd></>
            )}
            <dt className="total">{buyer ? "Total payé" : "Tu reçois"}</dt>
            <dd className="total tnum">{formatMoney(buyer ? order.totalMinor : order.itemsMinor + order.shippingToSellerMinor, order.currency)}</dd>
          </dl>
          {!buyer && order.shippingToSellerMinor > 0 && (
            <p className="hint" data-testid="seller-receives" style={{ margin: 0 }}>
              Tu reçois {formatMoney(order.itemsMinor, order.currency)} (articles) + {formatMoney(order.shippingToSellerMinor, order.currency)} (frais de livraison à remettre au coursier).
              C&apos;est à toi de payer le coursier de la main à la main.
            </p>
          )}
        </section>

        {courier && (
          <section className="stack" aria-labelledby="address-title">
            <h2 id="address-title" className="h2">Livraison par coursier</h2>
            <dl className="kv">
              <dt>Commune</dt><dd>{deliveryArea ?? "Non précisée"}</dd>
              <dt>Repère</dt><dd style={{ overflowWrap: "anywhere" }}>{order.deliveryLandmark ?? "Non précisé"}</dd>
            </dl>
          </section>
        )}
        {courier && ship && <ShipmentTimeline shipment={ship} />}

        <Link href={`/members/${order.counterpart.id}`} className="seller row-link" style={{ padding: 0, color: "inherit", textDecoration: "none" }}>
          <Avatar name={order.counterpart.displayName} />
          <div className="who"><span className="hint">{buyer ? "Vendeur" : "Acheteur"}</span><strong>{order.counterpart.displayName}</strong></div>
        </Link>
      </div>
    </div>
  );
}
