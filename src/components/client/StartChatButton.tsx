"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";

/** Ouvre (ou retrouve) la conversation avec le vendeur d'une annonce. */
export function StartChatButton({ itemId, label = "Écrire au vendeur", className = "btn btn-secondary btn-lg" }: { itemId: string; label?: string; className?: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ conversation: { id: string } }>("/conversations", { body: { itemId } });
      router.push(`/inbox/${r.conversation.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNAUTHENTICATED") return; // api() renvoie déjà vers la connexion
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <button type="button" className={className} onClick={start} disabled={busy || !hydrated} aria-busy={busy || undefined} aria-describedby={error ? "chat-err" : undefined}>
        {label}
      </button>
      {error && <span id="chat-err" className="error" role="alert">{error}</span>}
    </div>
  );
}
