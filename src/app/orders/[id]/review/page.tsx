import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReviewForm } from "@/components/client/ReviewForm";
import { AppBar, Banner } from "@/components/ui";
import { getData } from "@/lib/data";
import { parseIdOrNull } from "@/lib/schemas";
import { currentUser } from "@/lib/session";
import { isAppError } from "@/lib/types";

export const metadata: Metadata = { title: "Laisser un avis" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/orders/${id}/review`)}`);
  if (!parseIdOrNull(id)) notFound();
  const data = getData();
  let order, mine;
  try {
    order = await data.getOrder(id, me.id);
    mine = await data.getMyReview(id, me.id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  if (order.status !== "completed") redirect(`/orders/${id}`);
  return (
    <div className="narrow">
      <AppBar title="Ton avis" back={`/orders/${id}`} />
      <div className="pad stack-lg">
        {mine ? (
          <>
            <Banner kind="ok" title="Merci pour ton avis">Il apparaît sur le profil de {order.counterpart.displayName}.</Banner>
            <p className="tnum" style={{ margin: 0 }}><strong>{mine.rating} / 5</strong></p>
            {mine.comment && <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{mine.comment}</p>}
            <Link className="btn btn-secondary" href={`/orders/${id}`}>Retour à la commande</Link>
          </>
        ) : (
          <ReviewForm orderId={id} targetName={order.counterpart.displayName} />
        )}
      </div>
    </div>
  );
}
