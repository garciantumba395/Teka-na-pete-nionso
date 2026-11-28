"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";

// ---- agent J : lots (panier d'un même vendeur)
/** « Ajouter au panier ». Le serveur refuse son propre article, un article déjà dans le panier, indisponible, ou un 21e article. */
export function AddToCartButton({
  itemId, inCart = false, label = "Ajouter au panier", className = "btn btn-secondary btn-lg",
}: { itemId: string; inCart?: boolean; label?: string; className?: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(inCart);
  const [error, setError] = useState<string | null>(null);
  const errId = `cart-err-${itemId}`;

  async function add() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/cart", { body: { itemId } });
      setAdded(true);
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNAUTHENTICATED") return; // api() renvoie déjà vers la connexion
      if (e instanceof ApiError && e.code === "ALREADY_IN_CART") setAdded(true);
      else setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
    }
    setBusy(false);
  }

  if (added) {
    return (
      <div style={{ display: "grid", gap: 4 }}>
        <Link href="/cart" className={className} aria-label="Dans ton panier, voir le panier">Dans ton panier</Link>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <button type="button" className={className} onClick={add} disabled={busy || !hydrated} aria-busy={busy || undefined} aria-describedby={error ? errId : undefined}>
        {label}
      </button>
      {error && <span id={errId} className="error" role="alert">{error}</span>}
    </div>
  );
}
