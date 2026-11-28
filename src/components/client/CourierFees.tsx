"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";

/** Bouton « Marquer comme réglé au coursier » : solde les frais de livraison d'une commande (une seule fois). */
export function SettleCourierButton({ orderId, label }: { orderId: string; label: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function settle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/staff/courier-fees/${orderId}/settle`, { body: {} });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
      setBusy(false);
    }
  }
  return (
    <span style={{ display: "inline-flex", gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn btn-secondary" type="button" disabled={busy || !hydrated} onClick={settle} aria-label={`Marquer comme réglé au coursier : ${label}`}>
        Marquer comme réglé au coursier
      </button>
      {error && <span className="error" role="alert">{error}</span>}
    </span>
  );
}

/** Administrateur : choisit qui règle le coursier. Ne change que les libérations à venir. */
export function CourierModeForm({ mode }: { mode: "seller" | "platform" }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [value, setValue] = useState(mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/staff/courier-fee-mode", { method: "PUT", body: { mode: value } });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
    }
    setBusy(false);
  }
  return (
    <form className="stack" onSubmit={save} aria-labelledby="mode-title">
      <h2 id="mode-title" className="h2">Qui règle le coursier ?</h2>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack" aria-labelledby="mode-title">
        <label style={{ display: "flex", gap: "var(--space-8)", alignItems: "flex-start" }}>
          <input type="radio" name="mode" value="seller" checked={value === "seller"} onChange={() => setValue("seller")} />
          <span>Le vendeur règle le coursier : les frais de livraison lui sont versés à la libération.</span>
        </label>
        <label style={{ display: "flex", gap: "var(--space-8)", alignItems: "flex-start" }}>
          <input type="radio" name="mode" value="platform" checked={value === "platform"} onChange={() => setValue("platform")} />
          <span>La plateforme règle le coursier : les frais restent en attente jusqu&apos;au règlement par l&apos;assistance.</span>
        </label>
      </fieldset>
      <p className="hint" style={{ margin: 0 }}>Ne change que les libérations à venir. Les frais déjà versés ou en attente ne bougent pas.</p>
      <div style={{ display: "flex", gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !hydrated || value === mode && !saved}>Enregistrer le mode</button>
        {saved && <span role="status">Mode enregistré.</span>}
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    </form>
  );
}
