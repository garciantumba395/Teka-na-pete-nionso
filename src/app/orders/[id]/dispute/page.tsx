import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DisputeEvidencePanel, DisputeForm, DisputeThread } from "@/components/client/DisputeForms";
import { AppBar, Banner } from "@/components/ui";
import { DISPUTE_REASONS } from "@/lib/copy";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { parseIdOrNull } from "@/lib/schemas";
import { currentUser } from "@/lib/session";
import { isAppError } from "@/lib/types";

export const metadata: Metadata = { title: "Signaler un problème" };

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/orders/${id}/dispute`)}`);
  if (!parseIdOrNull(id)) notFound();
  const data = getData();
  let order, dispute;
  try {
    order = await data.getOrder(id, me.id);
    dispute = await data.getOrderDispute(id, me.id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  if (!dispute && !order.actions.includes("issue")) redirect(`/orders/${id}`);
  const reason = dispute ? DISPUTE_REASONS.find((r) => r.value === dispute.reason)?.label : "";

  return (
    <div className="narrow">
      <AppBar title="Un problème ?" back={`/orders/${id}`} />
      <div className="pad stack-lg">
        {!dispute ? (
          <>
            <Banner kind="info" title="Avant de continuer">
              Si tu es avec l&apos;autre personne, essaie d&apos;abord de régler le problème sur place. Tu peux aussi <Link href={`/orders/${id}`}>annuler la commande</Link> pour être remboursé si l&apos;article n&apos;a pas été remis.
            </Banner>
            <DisputeForm orderId={id} />
          </>
        ) : (
          <>
            {dispute.status === "open" && <Banner kind="warn" title="Litige en cours">L&apos;argent ({formatMoney(dispute.order.totalMinor, dispute.order.currency)}) reste bloqué. L&apos;assistance examine la situation et vous répondra ici.</Banner>}
            {dispute.status === "resolved_refund" && <Banner kind="ok" title="Litige clos : l'acheteur est remboursé">Le remboursement est total, frais de protection compris.</Banner>}
            {dispute.status === "resolved_release" && <Banner kind="ok" title="Litige clos : le vendeur est payé">L&apos;argent a été libéré au vendeur.</Banner>}
            <dl className="kv">
              <dt>Motif</dt><dd>{reason}</dd>
              <dt>Ouvert par</dt><dd>{dispute.openedByMe ? "Toi" : dispute.openedByName}</dd>
              <dt>Article</dt><dd style={{ overflowWrap: "anywhere" }}>{dispute.order.itemTitle}</dd>
            </dl>
            <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{dispute.description}</p>
            <DisputeEvidencePanel disputeId={dispute.id} evidence={dispute.evidence} open={dispute.status === "open"} />
            <DisputeThread disputeId={dispute.id} notes={dispute.notes} open={dispute.status === "open"} />
          </>
        )}
      </div>
    </div>
  );
}
