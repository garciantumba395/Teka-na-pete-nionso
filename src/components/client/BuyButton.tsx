"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";

export function BuyButton({ itemId, label }: { itemId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: { id: string } }>("/orders", { body: { itemIds: [itemId], deliveryMethod: "hand_delivery" } });
      router.push(`/orders/${r.order.id}/pay`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNAUTHENTICATED") {
        router.push(`/signin?next=${encodeURIComponent(`/items/${itemId}`)}`);
        return;
      }
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
      setBusy(false);
    }
  }

  return (
    <div style={{ flex: 1, display: "grid", gap: 4 }}>
      <button className="btn btn-primary btn-lg" onClick={buy} disabled={busy} aria-busy={busy || undefined} aria-describedby={error ? "buy-err" : undefined}>
        {label}
      </button>
      {error && <span id="buy-err" className="error" role="alert">{error}</span>}
    </div>
  );
}
