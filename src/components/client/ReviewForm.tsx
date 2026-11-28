"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";

export function ReviewForm({ orderId, targetName }: { orderId: string; targetName: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (rating < 1) { setError("Choisis une note de 1 à 5."); return; }
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${orderId}/review`, { body: { rating, comment } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
      setBusy(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "var(--space-8)" }}>
        <legend className="h2" style={{ marginBottom: "var(--space-8)" }}>Ton avis sur {targetName}</legend>
        <div role="radiogroup" aria-label="Note de 1 à 5" style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="chip" style={{ cursor: "pointer", minWidth: "var(--size-touch-min)", justifyContent: "center", outline: rating === n ? "2px solid var(--color-accent)" : undefined }}>
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              {n} <span className="sr-only">sur 5</span>
            </label>
          ))}
        </div>
        <span className="hint">1 = très déçu, 5 = parfait.</span>
      </fieldset>
      <div className="field">
        <label htmlFor="comment">Un mot pour les autres (facultatif)</label>
        <textarea id="comment" className="input" rows={4} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      {error && <span className="error" role="alert">{error}</span>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !hydrated} aria-busy={busy || undefined}>Publier mon avis</button>
    </form>
  );
}
