"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";

/**
 * Cœur « favori » d'une annonce. Bouton INDÉPENDANT (jamais dans le lien de la carte) : il ne fait pas naviguer.
 * Libellé « Ajouter aux favoris » / « Retirer des favoris », état pressé, inactif avant hydratation.
 * `variant` : « card » (sur la photo d'une carte), « detail » (fiche annonce) ou « list » (page Favoris : l'annonce disparaît au retrait).
 * Un visiteur non connecté est envoyé à la connexion par api() (401), puis revient sur la page.
 */
export function FavouriteButton({
  itemId, favourited, count, variant = "card",
}: { itemId: string; favourited: boolean; count: number; variant?: "card" | "detail" | "list" }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [on, setOn] = useState(favourited);
  const [n, setN] = useState(count);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descId = useId();

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = on
        ? await api<{ favouriteCount: number }>(`/favourites/${itemId}`, { method: "DELETE" })
        : await api<{ favouriteCount: number }>("/favourites", { body: { itemId } });
      setOn(!on);
      setN(r.favouriteCount);
      if (variant === "list" && on) {
        router.refresh();
        document.getElementById("main")?.focus();
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNAUTHENTICATED") return; // api() renvoie déjà vers la connexion
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`fav-wrap fav-${variant}`}>
      <button
        type="button"
        className="fav-btn"
        aria-label={on ? "Retirer des favoris" : "Ajouter aux favoris"}
        aria-pressed={on}
        aria-describedby={descId}
        data-count={n}
        onClick={toggle}
        aria-busy={busy || undefined}
        disabled={!hydrated} /* pas « disabled » pendant l'appel : le clavier perdrait le focus */
      >
        <Icon name="heart" fill={on} />
        {/* le nombre est dessiné en CSS (data-count) : du texte visible dans le bouton devrait faire partie de son nom accessible */}
      </button>
      <span id={descId} className="sr-only">{n === 0 ? "Aucun favori" : `${n} favori${n > 1 ? "s" : ""}`}</span>
      {error ? <span className="error fav-error" role="alert">{error}</span> : null}
    </div>
  );
}
