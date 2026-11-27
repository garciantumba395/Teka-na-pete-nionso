"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";

/** Action simple de la livraison par coursier : un appel, puis rafraîchissement de la page. */
function useAction(orderId: string, path: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(body: unknown = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${orderId}/${path}`, { body });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** Vendeur : renseigne le coursier et marque le colis comme remis. */
export function ShipForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [courierName, setCourierName] = useState("");
  const [courierPhone, setCourierPhone] = useState("");
  const [trackingRef, setTrackingRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      await api(`/orders/${orderId}/ship`, { body: { courierName, courierPhone, trackingRef: trackingRef.trim() || null } });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...(err.details ?? {}), form: err.details ? "" : err.message });
      else setErrors({ form: "Erreur inattendue." });
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate aria-labelledby="ship-title" style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
      <h2 id="ship-title" className="h2">Expédier le colis</h2>
      <p className="muted" style={{ margin: 0 }}>
        Confie le colis à un coursier de ton choix, puis renseigne-le ici. L&apos;acheteur verra son nom et son numéro pour suivre la livraison.
      </p>
      <div className="field">
        <label htmlFor="c-name">Nom du coursier</label>
        <input id="c-name" className="input" maxLength={80} value={courierName} onChange={(e) => setCourierName(e.target.value)} aria-invalid={errors.courierName ? true : undefined} aria-describedby={errors.courierName ? "c-name-err" : undefined} />
        {errors.courierName && <span id="c-name-err" className="error" role="alert">{errors.courierName}</span>}
      </div>
      <div className="field">
        <label htmlFor="c-phone">Téléphone du coursier</label>
        <input id="c-phone" className="input" type="tel" inputMode="tel" autoComplete="off" maxLength={30} value={courierPhone} onChange={(e) => setCourierPhone(e.target.value)} aria-invalid={errors.courierPhone ? true : undefined} aria-describedby={errors.courierPhone ? "c-phone-err" : undefined} />
        {errors.courierPhone && <span id="c-phone-err" className="error" role="alert">{errors.courierPhone}</span>}
      </div>
      <div className="field">
        <label htmlFor="c-ref">Référence de suivi (facultatif)</label>
        <input id="c-ref" className="input" maxLength={60} value={trackingRef} onChange={(e) => setTrackingRef(e.target.value)} />
      </div>
      {errors.form && <span className="error" role="alert">{errors.form}</span>}
      <button className="btn btn-primary" type="submit" disabled={busy || !hydrated} aria-busy={busy || undefined}>Marquer comme remis au coursier</button>
    </form>
  );
}

/** Vendeur (pour le compte du coursier) : le colis est parti. */
export function InTransitButton({ orderId }: { orderId: string }) {
  const hydrated = useHydrated();
  const { busy, error, run } = useAction(orderId, "in-transit");
  return (
    <div className="stack">
      <button className="btn btn-secondary" type="button" onClick={() => run()} disabled={busy || !hydrated} aria-busy={busy || undefined}>Le colis est en route</button>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}

/** Acheteur : « J'ai reçu mon colis ». Démarre le délai de réclamation. */
export function ReceivedButton({ orderId }: { orderId: string }) {
  const hydrated = useHydrated();
  const { busy, error, run } = useAction(orderId, "received");
  return (
    <div className="stack">
      <button className="btn btn-primary btn-lg" type="button" onClick={() => run()} disabled={busy || !hydrated} aria-busy={busy || undefined}>J&apos;ai reçu mon colis</button>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}

/** Acheteur : accepte l'article, l'argent est libéré au vendeur tout de suite. */
export function AcceptButton({ orderId }: { orderId: string }) {
  const hydrated = useHydrated();
  const { busy, error, run } = useAction(orderId, "accept");
  return (
    <div className="stack">
      <button className="btn btn-primary btn-lg" type="button" onClick={() => run()} disabled={busy || !hydrated} aria-busy={busy || undefined}>Tout est bon, libérer l&apos;argent</button>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}

/** « Colis non reçu » : ouvre un litige. Deux temps, pour qu'un clic accidentel ne gèle pas l'argent. */
export function LostButton({ orderId, role }: { orderId: string; role: "buyer" | "seller" }) {
  const hydrated = useHydrated();
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useAction(orderId, "lost");
  if (!asking) return <button className="btn btn-ghost" type="button" onClick={() => setAsking(true)} disabled={!hydrated}>{role === "buyer" ? "Colis non reçu" : "Colis perdu"}</button>;
  return (
    <div className="banner warn" role="alertdialog" aria-labelledby="lost-title">
      <div className="stack" style={{ flex: 1 }}>
        <strong id="lost-title">{role === "buyer" ? "Tu n'as pas reçu ton colis ?" : "Le colis est perdu ?"}</strong>
        <span>Un litige sera ouvert et l&apos;argent restera bloqué le temps que l&apos;assistance examine la situation.</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-danger btn-sm" type="button" onClick={() => run({})} disabled={busy} aria-busy={busy || undefined}>Oui, signaler le colis perdu</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAsking(false)} disabled={busy}>Non, attendre encore</button>
        </div>
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    </div>
  );
}
