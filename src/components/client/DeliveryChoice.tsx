"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiError } from "./api";
import { formatMoney } from "@/lib/money";
import type { Area, Currency, ShippingQuote } from "@/lib/types";

// Choix du mode de livraison, partagé entre le sélecteur (dans la page) et le bouton « Acheter » (dans la barre du bas).
// Petit magasin au niveau du module : les deux composants clients sont rendus à des endroits différents de la page.
export interface DeliveryState {
  method: "hand_delivery" | "courier";
  areaId: string;
  landmark: string;
}
const DEFAULT: DeliveryState = { method: "hand_delivery", areaId: "", landmark: "" };
let state: DeliveryState = DEFAULT;
const subs = new Set<() => void>();
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => { subs.delete(cb); };
};
function setDelivery(patch: Partial<DeliveryState>) {
  state = { ...state, ...patch };
  subs.forEach((cb) => cb());
}
export function useDelivery(): DeliveryState {
  return useSyncExternalStore(subscribe, () => state, () => DEFAULT);
}

/** Erreurs de saisie du mode coursier, avant tout appel au serveur (le serveur revalide toujours). */
export function courierProblem(d: DeliveryState): string | null {
  if (d.method !== "courier") return null;
  if (!d.areaId) return "Choisis ta commune pour la livraison.";
  if (d.landmark.trim().length < 3) return "Décris un repère pour le coursier (3 caractères au moins).";
  return null;
}

export function DeliveryPicker({ itemId, currency, protectedPriceMinor }: { itemId: string; currency: Currency; protectedPriceMinor: number }) {
  const d = useDelivery();
  const [communes, setCommunes] = useState<Area[]>([]);
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Nouvelle annonce : on repart du choix par défaut.
  useEffect(() => {
    setDelivery({ ...DEFAULT });
  }, [itemId]);

  useEffect(() => {
    if (d.method !== "courier" || communes.length > 0) return;
    let live = true;
    api<{ areas: Area[] }>("/areas")
      .then((r) => { if (live) setCommunes(r.areas.filter((a) => a.kind === "commune")); })
      .catch(() => { if (live) setQuoteError("Impossible de charger les communes. Réessaie."); });
    return () => { live = false; };
  }, [d.method, communes.length]);

  useEffect(() => {
    if (d.method !== "courier" || !d.areaId) return;
    let live = true;
    api<{ quote: ShippingQuote }>(`/shipping/quote?itemId=${encodeURIComponent(itemId)}&areaId=${encodeURIComponent(d.areaId)}`)
      .then((r) => { if (live) { setQuote(r.quote); setQuoteError(null); } })
      .catch((e) => { if (live) { setQuote(null); setQuoteError(e instanceof ApiError ? e.message : "Erreur inattendue."); } });
    return () => { live = false; };
  }, [d.method, d.areaId, itemId]);

  const radio = (value: DeliveryState["method"], title: string, hint: string) => (
    <label className="row" style={{ display: "flex", gap: "var(--space-12)", alignItems: "flex-start", cursor: "pointer" }}>
      <input type="radio" name="delivery" value={value} checked={d.method === value} onChange={() => setDelivery({ method: value })} style={{ marginTop: 4 }} />
      <span><strong style={{ display: "block" }}>{title}</strong><span className="hint">{hint}</span></span>
    </label>
  );

  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="h2" style={{ marginBottom: "var(--space-8)" }}>Mode de livraison</legend>
      {radio("hand_delivery", "Remise en main propre", "Tu paies sur l'appli, tu vérifies l'article, puis tu donnes un code au vendeur. Il ne reçoit l'argent qu'à ce moment-là.")}
      {radio("courier", "Livraison par coursier", "Un coursier indépendant, choisi par le vendeur, t'apporte le colis. L'argent reste bloqué jusqu'à ta confirmation, ou jusqu'à la fin du délai de réclamation sans litige.")}
      {d.method === "courier" && (
        <div className="stack">
          <div className="field">
            <label htmlFor="d-area">Ta commune</label>
            <select id="d-area" className="input" value={d.areaId} onChange={(e) => setDelivery({ areaId: e.target.value })}>
              <option value="">Choisir une commune</option>
              {communes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-landmark">Repère pour le coursier</label>
            <input id="d-landmark" className="input" maxLength={200} value={d.landmark} onChange={(e) => setDelivery({ landmark: e.target.value })} aria-describedby="d-landmark-hint" />
            <span id="d-landmark-hint" className="hint">Par exemple : « en face de la pharmacie, avenue de la Paix, portail bleu ».</span>
          </div>
          <p className="hint" style={{ margin: 0 }} role="status">
            {quote
              ? <>Livraison : <strong className="tnum">{formatMoney(quote.shippingMinor, quote.currency)}</strong>. Total à payer : <strong className="tnum">{formatMoney(protectedPriceMinor + quote.shippingMinor, currency)}</strong>.</>
              : quoteError ?? "Choisis ta commune pour voir les frais de livraison."}
          </p>
        </div>
      )}
    </fieldset>
  );
}
