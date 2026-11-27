"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { OtpInput } from "./OtpInput";
import { Icon } from "../icons";

/** Rafraîchit la page quand le statut de la commande change côté serveur (paiement reçu, remise validée…). */
export function OrderLive({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  useEffect(() => {
    if (["completed", "cancelled", "expired", "refunded"].includes(status)) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api<{ order: { status: string } }>(`/orders/${orderId}`);
        if (r.order.status !== status) router.refresh();
      } catch {
        /* on réessaie */
      }
    }, 4000);
    return () => clearInterval(t);
  }, [orderId, status, router]);
  return null;
}

/** Code de remise : caché par défaut, affiché à la demande de l'acheteur. */
export function HandoverCodeCard({ orderId }: { orderId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (shown) {
      setShown(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ code: string }>(`/orders/${orderId}/handover-code`);
      setCode(r.code);
      setShown(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-labelledby="code-title" style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
      <h2 id="code-title" className="h2" style={{ display: "flex", gap: 8, alignItems: "center" }}><Icon name="lock" /> Code de remise</h2>
      {shown && code ? (
        <div className="code reveal" role="img" aria-label={`Code de remise : ${code.split("").join(" ")}`}>
          {code.split("").map((d, i) => <span key={i}>{d}</span>)}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>Caché pour l&apos;instant.</p>
      )}
      <p className="hint" style={{ margin: 0 }}>
        Donne ce code au vendeur <strong>seulement après avoir vérifié l&apos;article</strong>. Il libère l&apos;argent : après, plus de retour possible par l&apos;appli.
      </p>
      <button className="btn btn-secondary" type="button" onClick={toggle} aria-expanded={shown} disabled={busy} aria-busy={busy || undefined}>
        <Icon name="eye" /> {shown ? "Masquer le code" : "Afficher mon code"}
      </button>
      {error && <span className="error" role="alert">{error}</span>}
    </section>
  );
}

/** Saisie du code par le vendeur, avec compteur d'essais. */
export function ConfirmCodeForm({ orderId, attemptsLeft, lockedUntil }: { orderId: string; attemptsLeft: number; lockedUntil: number | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(!!lockedUntil && lockedUntil > Date.now());

  async function submit(c: string) {
    if (busy || c.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${orderId}/confirm-delivery`, { body: { code: c } });
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "CODE_LOCKED") setLocked(true);
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
      setCode("");
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-labelledby="confirm-title" style={{ background: "var(--color-surface)", borderRadius: "var(--radius-md)", padding: "var(--space-16)" }}>
      <h2 id="confirm-title" className="h2">Code de l&apos;acheteur</h2>
      <p className="muted" style={{ margin: 0 }}>
        Quand l&apos;acheteur a vérifié l&apos;article, il te donne un code à 6 chiffres. Saisis-le pour recevoir l&apos;argent.
      </p>
      <OtpInput value={code} onChange={setCode} onComplete={submit} label="Code de l'acheteur" invalid={!!error} disabled={locked} describedBy={error ? "confirm-err" : undefined} />
      {error && <span id="confirm-err" className="error" role="alert">{error}</span>}
      {locked && <span className="hint">La saisie est bloquée un moment après trop d&apos;essais. Réessaie dans quelques minutes.</span>}
      {!locked && !error && attemptsLeft < 5 && <span className="hint">Il te reste {attemptsLeft} essai{attemptsLeft > 1 ? "s" : ""}.</span>}
      <button className="btn btn-primary" type="button" disabled={busy || locked || code.length < 6} aria-busy={busy || undefined} onClick={() => submit(code)}>
        Valider et recevoir l&apos;argent
      </button>
    </section>
  );
}

/** Annulation en deux temps : aucun clic accidentel ne rembourse ni n'annule. */
export function CancelOrder({ orderId, intro, confirmLabel }: { orderId: string; intro: string; confirmLabel: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${orderId}/cancel`, { body: {} });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
      setBusy(false);
    }
  }

  if (!asking) return <button className="btn btn-ghost" type="button" onClick={() => setAsking(true)}>Annuler la commande</button>;
  return (
    <div className="banner warn" role="alertdialog" aria-labelledby="cancel-title">
      <div className="stack" style={{ flex: 1 }}>
        <strong id="cancel-title">Annuler cette commande ?</strong>
        <span>{intro}</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-danger btn-sm" type="button" onClick={run} disabled={busy} aria-busy={busy || undefined}>{confirmLabel}</button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAsking(false)} disabled={busy}>Non, la garder</button>
        </div>
        {error && <span className="error" role="alert">{error}</span>}
      </div>
    </div>
  );
}
