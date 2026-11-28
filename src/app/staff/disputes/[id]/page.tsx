import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DisputeEvidencePanel, DisputeThread, ResolveDispute } from "@/components/client/DisputeForms";
import { AppBar, Banner } from "@/components/ui";
import { DISPUTE_REASONS } from "@/lib/copy";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { parseIdOrNull } from "@/lib/schemas";
import { currentUser } from "@/lib/session";
import { isAppError } from "@/lib/types";

export const metadata: Metadata = { title: "Litige" };

export default async function StaffDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/staff/disputes/${id}`)}`);
  if (!["support", "admin"].includes(me.role ?? "member") || !parseIdOrNull(id)) notFound();
  let d;
  try {
    d = await getData().getDisputeById(id, me.id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  return (
    <div className="narrow">
      <AppBar title="Litige" back="/staff" />
      <div className="pad stack-lg">
        {d.status !== "open" && <Banner kind="ok" title={d.status === "resolved_refund" ? "Clos : acheteur remboursé" : "Clos : vendeur payé"} />}
        <dl className="kv">
          <dt>Article</dt><dd style={{ overflowWrap: "anywhere" }}>{d.order.itemTitle}</dd>
          <dt>Montant bloqué</dt><dd className="tnum">{formatMoney(d.order.totalMinor, d.order.currency)}</dd>
          <dt>Acheteur</dt><dd>{d.order.buyerName}</dd>
          <dt>Vendeur</dt><dd>{d.order.sellerName}</dd>
          <dt>Motif</dt><dd>{DISPUTE_REASONS.find((r) => r.value === d.reason)?.label}</dd>
          <dt>Ouvert par</dt><dd>{d.openedByName}</dd>
        </dl>
        <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{d.description}</p>
        <DisputeEvidencePanel disputeId={d.id} evidence={d.evidence} open={d.status === "open"} />
        <DisputeThread disputeId={d.id} notes={d.notes} open={d.status === "open"} />
        {d.status === "open" && <ResolveDispute disputeId={d.id} />}
      </div>
    </div>
  );
}
