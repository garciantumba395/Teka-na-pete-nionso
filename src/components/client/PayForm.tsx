"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, newKey } from "./api";
import { PAYMENT_METHODS } from "@/lib/copy";

type Phase = "form" | "pending" | "failed";
interface PaymentState { orderStatus: string; payment: { status: string; failureCode: string | null } | null }

const FAILURE_TEXT: Record<string, string> = {
  INSUFFICIENT_FUNDS: "Solde insuffisant sur ton compte mobile money.",
};

function Countdown({ expiresAt, onExpire }: { expiresAt: number; onExpire: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, expiresAt - Date.now()));
  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, expiresAt - Date.now());
      setLeft(l);
      if (l === 0) {
        clearInterval(t);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, onExpire]);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span className="tnum" role="timer" aria-live="off">{m}:{String(s).padStart(2, "0")}</span>
  );
}

export function PayForm({
  orderId, totalLabel, defaultPhone, expiresAt, initialPending,
}: { orderId: string; totalLabel: string; defaultPhone: string; expiresAt: number; initialPending: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initialPending ? "pending" : "form");
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0].value);
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const poll = useCallback(async () => {
    try {
      const s = await api<PaymentState>(`/orders/${orderId}/payment`);
      if (s.payment?.status === "succeeded" || (s.orderStatus !== "pending_payment" && s.payment?.status !== "pending_user")) {
        stop();
        router.replace(`/orders/${orderId}`);
        router.refresh();
      } else if (s.payment?.status === "failed") {
        stop();
        keyRef.current = newKey();
        setError(FAILURE_TEXT[s.payment.failureCode ?? ""] ?? "Le paiement a été refusé.");
        setPhase("failed");
      }
    } catch {
      /* réseau instable : on réessaie au prochain tour */
    }
  }, [orderId, router]);

  useEffect(() => {
    if (phase !== "pending") return;
    timer.current = setInterval(poll, 2000);
    void poll();
    return stop;
  }, [phase, poll]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${orderId}/pay`, { body: { method, msisdn: phone, idempotencyKey: keyRef.current } });
      setPhase("pending");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  const expire = useCallback(() => {
    stop();
    router.refresh();
    router.replace(`/orders/${orderId}`);
  }, [orderId, router]);

  async function cancel() {
    try {
      await api(`/orders/${orderId}/cancel`, { body: {} });
    } finally {
      router.push("/");
      router.refresh();
    }
  }

  if (phase === "pending") {
    return (
      <div className="stack-lg" aria-live="polite">
        <div className="pending" role="status">
          <div className="pulse" aria-hidden="true" />
          <strong>Valide le paiement sur ton téléphone</strong>
          <span className="muted">Entre ton code secret quand le message apparaît. Ne ferme pas cette page, elle se met à jour toute seule.</span>
        </div>
        <p className="hint" style={{ textAlign: "center", margin: 0 }}>
          Article réservé encore <Countdown expiresAt={expiresAt} onExpire={expire} />
        </p>
      </div>
    );
  }

  return (
    <form className="stack-lg" onSubmit={pay} noValidate>
      {error && (
        <div className="banner danger" role="alert">
          <div><strong>{phase === "failed" ? "Paiement refusé" : "Impossible de payer"}</strong>{error}</div>
        </div>
      )}

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ font: "600 var(--text-sm-size)/var(--text-sm-line) var(--font-sans)", marginBottom: 8 }}>Moyen de paiement</legend>
        <div className="momo" role="radiogroup" aria-label="Moyen de paiement">
          {PAYMENT_METHODS.map((m) => (
            <label key={m.value}>
              <input type="radio" name="method" value={m.value} checked={method === m.value} onChange={() => setMethod(m.value)} />
              <span className="name">{m.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="msisdn">Numéro à débiter</label>
        <div className="phone">
          <span className="prefix" aria-hidden="true">+243</span>
          <input id="msisdn" className="input tnum" type="tel" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(e.target.value)} aria-describedby="msisdn-hint" />
        </div>
        <span id="msisdn-hint" className="hint">Tu recevras une demande de validation sur ce numéro.</span>
      </div>

      <div className="stack">
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy} aria-busy={busy || undefined}>Payer {totalLabel}</button>
        <button className="btn btn-ghost" type="button" onClick={cancel}>Annuler la commande</button>
      </div>
      <p className="hint" style={{ margin: 0, textAlign: "center" }}>Article réservé encore <Countdown expiresAt={expiresAt} onExpire={expire} /></p>
    </form>
  );
}
