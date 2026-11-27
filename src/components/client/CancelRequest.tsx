"use client";

// Annulation encadrée après paiement (agent A). Côté acheteur : demander / suivre / retirer. Côté vendeur : accepter / refuser.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";
import { Banner } from "../ui";

// Fuseau fixe : sinon la date rendue côté serveur diffère de celle du navigateur (erreur d'hydratation).
const cancelFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });

type CancelRequestState = { status: "pending" | "accepted" | "declined" | "expired"; requestedAt: number; expiresAt: number } | null;
type Path = "cancel-request" | "cancel-request/withdraw" | "cancel-request/accept" | "cancel-request/decline";

/** Appelle une action d'annulation encadrée, puis rafraîchit la page. Un seul envoi à la fois (double clic). */
function useCancelAction(orderId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(path: Path, then?: () => void) {
    if (busy) return;
    setBusy(path);
    setError(null);
    try {
      await api(`/orders/${orderId}/${path}`, { body: {} });
      then?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run };
}

/** Côté acheteur, commande payée et pas encore remise : demander l'annulation (le vendeur doit accepter), suivre ou retirer sa demande. */
export function BuyerCancelRequest({ orderId, request, canRequest, canWithdraw }: { orderId: string; request: CancelRequestState; canRequest: boolean; canWithdraw: boolean }) {
  const hydrated = useHydrated();
  const { busy, error, run } = useCancelAction(orderId);
  const [asking, setAsking] = useState(false);

  if (request && request.status === "pending" && canWithdraw) {
    return (
      <div className="stack">
        <Banner kind="info" title="Demande d'annulation envoyée" role="status">
          {" "}Le vendeur a jusqu&apos;au {cancelFmt.format(request.expiresAt)} pour répondre. S&apos;il accepte, tu es remboursé en totalité. Sans réponse, la demande est close et tu peux ouvrir un litige.
        </Banner>
        <button className="btn btn-secondary" type="button" disabled={!hydrated || !!busy} aria-busy={!!busy || undefined} onClick={() => run("cancel-request/withdraw")}>
          Retirer ma demande
        </button>
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    );
  }
  if (request && (request.status === "declined" || request.status === "expired")) {
    return (
      <Banner kind="warn" title={request.status === "declined" ? "Le vendeur a refusé l'annulation" : "Le vendeur n'a pas répondu à ta demande"}>
        {" "}Ton argent reste bloqué en sécurité. Si tu as un problème avec cette commande, ouvre un litige : l&apos;assistance examinera la situation.
      </Banner>
    );
  }
  if (!canRequest) return null;
  if (!asking) {
    return <button className="btn btn-ghost" type="button" disabled={!hydrated} onClick={() => setAsking(true)}>Demander l&apos;annulation</button>;
  }
  return (
    <div className="banner warn" role="alertdialog" aria-labelledby="creq-title" aria-describedby="creq-desc">
      <div className="stack" style={{ flex: 1 }}>
        <strong id="creq-title">Demander l&apos;annulation de cette commande ?</strong>
        <span id="creq-desc">
          Une fois payée, la commande ne s&apos;annule plus seul : le vendeur doit accepter. S&apos;il accepte, tu es remboursé en totalité, frais de protection compris. S&apos;il refuse ou ne répond pas, ton argent reste bloqué et tu peux ouvrir un litige, que l&apos;assistance tranchera.
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-danger btn-sm" type="button" onClick={() => run("cancel-request", () => setAsking(false))} disabled={!hydrated || !!busy} aria-busy={!!busy || undefined}>
            Oui, envoyer la demande
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAsking(false)} disabled={!!busy}>Non, ne rien envoyer</button>
        </div>
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/** Côté vendeur : la demande de l'acheteur, à accepter (remboursement intégral) ou refuser. */
export function SellerCancelRequest({ orderId, request, canAnswer }: { orderId: string; request: CancelRequestState; canAnswer: boolean }) {
  const hydrated = useHydrated();
  const { busy, error, run } = useCancelAction(orderId);
  const [confirming, setConfirming] = useState(false);
  if (!request) return null;
  if (request.status === "declined" || request.status === "expired") {
    return (
      <Banner kind="info" title={request.status === "declined" ? "Tu as refusé la demande d'annulation" : "Demande d'annulation restée sans réponse"}>
        {" "}L&apos;acheteur peut ouvrir un litige si le désaccord persiste. Tu peux toujours finaliser la vente avec son code.
      </Banner>
    );
  }
  if (request.status !== "pending" || !canAnswer) return null;
  return (
    <section className="stack" aria-labelledby="sreq-title" style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
      <h2 id="sreq-title" className="h2">L&apos;acheteur demande l&apos;annulation</h2>
      <p className="muted" style={{ margin: 0 }}>
        Demande reçue le {cancelFmt.format(request.requestedAt)}. Si tu acceptes, l&apos;acheteur est remboursé en totalité et l&apos;article est remis en vente. Si tu refuses, il peut ouvrir un litige. Sans réponse avant le {cancelFmt.format(request.expiresAt)}, la demande est close. La remise par code reste possible et vaut acceptation de l&apos;article.
      </p>
      {confirming ? (
        <div className="banner warn" role="alertdialog" aria-labelledby="sreq-confirm">
          <div className="stack" style={{ flex: 1 }}>
            <strong id="sreq-confirm">Accepter l&apos;annulation ?</strong>
            <span>La vente est annulée et l&apos;acheteur remboursé tout de suite. Cette action est définitive.</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-danger btn-sm" type="button" disabled={!hydrated || !!busy} aria-busy={!!busy || undefined} onClick={() => run("cancel-request/accept")}>Oui, accepter et rembourser</button>
              <button className="btn btn-secondary btn-sm" type="button" disabled={!!busy} onClick={() => setConfirming(false)}>Non, revenir</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" disabled={!hydrated || !!busy} onClick={() => setConfirming(true)}>Accepter l&apos;annulation</button>
          <button className="btn btn-secondary" type="button" disabled={!hydrated || !!busy} aria-busy={busy === "cancel-request/decline" || undefined} onClick={() => run("cancel-request/decline")}>Refuser</button>
        </div>
      )}
      {error && <span className="error" role="alert">{error}</span>}
    </section>
  );
}
