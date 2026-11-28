"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/lib/money";
import type { CartLot } from "@/lib/types";
import { api, ApiError } from "./api";
import { courierProblem, DeliveryPicker, useDelivery } from "./DeliveryChoice";
import { useHydrated } from "./useHydrated";

// ---- agent J : lots (panier d'un même vendeur)
const REASON: Record<string, string> = {
  reserved: "Un autre acheteur est en train de le payer.",
  sold: "Vendu.",
  unavailable: "Plus disponible.",
};

export function CartLots({ lots }: { lots: CartLot[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const sellerCount = (id: string) => lots.filter((l) => l.sellerId === id).length;
  return (
    <div className="stack-lg">
      {lots.map((lot) => {
        const key = `${lot.sellerId}-${lot.currency}`;
        return (
          <LotCard key={key} lot={lot} lotKey={key} open={openKey === key} onOpen={() => setOpenKey(openKey === key ? null : key)} splitNote={sellerCount(lot.sellerId) > 1} />
        );
      })}
    </div>
  );
}

function LotCard({ lot, lotKey, open, onOpen, splitNote }: { lot: CartLot; lotKey: string; open: boolean; onOpen: () => void; splitNote: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const delivery = useDelivery();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unavailable = lot.lines.filter((l) => !l.available);
  const blocked = unavailable.length > 0 || lot.orderableItemIds.length === 0 || lot.overLimit;
  const titleId = `lot-${lotKey}`;
  const errId = `lot-err-${lotKey}`;

  async function remove(itemIds: string[]) {
    if (busy) return;
    setBusy("remove");
    setError(null);
    try {
      for (const itemId of itemIds) await api("/cart/remove", { body: { itemId } });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
    }
    setBusy(null);
  }

  async function order() {
    if (busy) return;
    const problem = courierProblem(delivery);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy("order");
    setError(null);
    try {
      const body = delivery.method === "courier"
        ? { itemIds: lot.orderableItemIds, deliveryMethod: "courier", deliveryAreaId: delivery.areaId, deliveryLandmark: delivery.landmark.trim() }
        : { itemIds: lot.orderableItemIds, deliveryMethod: "hand_delivery" };
      const r = await api<{ order: { id: string } }>("/orders", { body });
      router.push(`/orders/${r.order.id}/pay`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
      setBusy(null);
      router.refresh(); // le panier se met à jour : les articles devenus indisponibles sont signalés
    }
  }

  return (
    <section className="stack" aria-labelledby={titleId} data-testid="cart-lot">
      <h2 id={titleId} className="h2" style={{ overflowWrap: "anywhere" }}>
        Lot de <Link href={`/members/${lot.sellerId}`}>{lot.sellerName}</Link> · {lot.currency === "USD" ? "dollars" : "francs congolais"}
      </h2>
      {splitNote && <p className="hint" style={{ margin: 0 }}>Ce vendeur a des articles dans deux devises : ils forment deux lots, avec deux commandes et deux paiements.</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
        {lot.lines.map((l) => (
          <li key={l.itemId} style={{ display: "flex", gap: 12, alignItems: "center", opacity: l.available ? 1 : 0.75 }}>
            {l.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.photo} alt="" width={56} height={72} style={{ objectFit: "cover", borderRadius: "var(--radius-sm)", flex: "0 0 auto" }} />
            ) : null}
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
              <Link href={`/items/${l.itemId}`}>{l.title}</Link>
              {!l.available && <span className="error" role="note" style={{ display: "block" }}>{REASON[l.reason ?? "unavailable"]}</span>}
            </span>
            <span className="price tnum">{formatMoney(l.priceMinor, l.currency)}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!hydrated || busy !== null} onClick={() => remove([l.itemId])} aria-label={`Retirer ${l.title} du panier`}>
              Retirer
            </button>
          </li>
        ))}
      </ul>
      {lot.orderableItemIds.length > 0 && (
        <dl className="kv">
          <dt>Sous-total ({lot.orderableItemIds.length} article{lot.orderableItemIds.length > 1 ? "s" : ""})</dt><dd className="tnum">{formatMoney(lot.itemsMinor, lot.currency)}</dd>
          <dt>Protection acheteur</dt><dd className="tnum">{formatMoney(lot.protectionFeeMinor, lot.currency)}</dd>
          <dt className="total">Total (hors livraison)</dt><dd className="total tnum">{formatMoney(lot.totalMinor, lot.currency)}</dd>
        </dl>
      )}
      {lot.overLimit && <p className="error" role="alert" style={{ margin: 0 }}>Le total de ce lot dépasse la valeur maximale autorisée par commande. Retire des articles pour continuer.</p>}
      {unavailable.length > 0 && (
        <div className="stack">
          <p className="hint" style={{ margin: 0 }} role="status">
            {unavailable.length > 1 ? "Certains articles ne sont plus disponibles." : "Un article n'est plus disponible."} Retire-{unavailable.length > 1 ? "les" : "le"} pour commander le reste du lot.
          </p>
          <button type="button" className="btn btn-secondary" disabled={!hydrated || busy !== null} onClick={() => remove(unavailable.map((l) => l.itemId))}>
            Retirer {unavailable.length > 1 ? "les articles indisponibles" : "l'article indisponible"}
          </button>
        </div>
      )}
      {open && lot.quoteItemId && !blocked && (
        <div className="stack">
          <DeliveryPicker itemId={lot.quoteItemId} currency={lot.currency} protectedPriceMinor={lot.totalMinor} />
          <button type="button" className="btn btn-primary btn-lg" onClick={order} disabled={!hydrated || busy !== null} aria-busy={busy === "order" || undefined} aria-describedby={error ? errId : undefined}>
            Confirmer la commande du lot
          </button>
        </div>
      )}
      {(!open || blocked) && (
        <button type="button" className="btn btn-primary btn-lg" onClick={onOpen} disabled={!hydrated || blocked}>
          Commander le lot · {formatMoney(lot.totalMinor, lot.currency)}
        </button>
      )}
      {error && <span id={errId} className="error" role="alert">{error}</span>}
    </section>
  );
}
