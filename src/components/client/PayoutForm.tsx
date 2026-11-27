"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, newKey } from "./api";
import { PAYMENT_METHODS } from "@/lib/copy";
import { FEES, payoutFee } from "@/lib/fees";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import type { Currency } from "@/lib/types";

export function PayoutForm({ balances, defaultPhone }: { balances: { currency: Currency; availableMinor: number }[]; defaultPhone: string }) {
  const router = useRouter();
  const usable = balances.filter((b) => b.availableMinor > 0);
  const [currency, setCurrency] = useState<Currency>(usable[0]?.currency ?? "USD");
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0].value);
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(newKey());

  const available = balances.find((b) => b.currency === currency)?.availableMinor ?? 0;
  const amount = parseMoneyInput(amountRaw, currency);
  const fee = amount ? payoutFee(amount) : 0;
  const min = FEES.payout.minMinor[currency];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!amount) return setError(currency === "CDF" ? "Indique un montant en francs entiers." : "Indique un montant valide (ex. 25,50).");
    if (amount < min) return setError(`Le minimum de retrait est ${formatMoney(min, currency)}.`);
    if (amount + fee > available) return setError("Ton solde ne couvre pas ce montant avec les frais de retrait.");
    setBusy(true);
    try {
      await api("/payouts", { body: { amountMinor: amount, currency, method, msisdn: phone, idempotencyKey: keyRef.current } });
      keyRef.current = newKey();
      setAmountRaw("");
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  if (usable.length === 0) {
    return <p className="muted" style={{ margin: 0 }}>Aucun montant à retirer pour l&apos;instant. Ton solde augmente dès qu&apos;une vente est confirmée.</p>;
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {done && <div className="banner ok" role="status"><div><strong>Retrait demandé</strong>Tu recevras une demande sur ton téléphone dans un instant.</div></div>}
      {error && <div className="banner danger" role="alert"><div>{error}</div></div>}
      {usable.length > 1 && (
        <div className="segmented" role="group" aria-label="Devise">
          {usable.map((b) => <button key={b.currency} type="button" aria-pressed={currency === b.currency} onClick={() => setCurrency(b.currency)}>{b.currency}</button>)}
        </div>
      )}
      <div className="field">
        <label htmlFor="amount">Montant à retirer ({currency})</label>
        <input id="amount" className="input tnum" inputMode="decimal" value={amountRaw} onChange={(e) => { setAmountRaw(e.target.value); setDone(false); }} aria-describedby="amount-hint" />
        <span id="amount-hint" className="hint">
          Disponible : {formatMoney(available, currency)}. Frais de retrait : {formatMoney(fee, currency)}. Minimum : {formatMoney(min, currency)}.
        </span>
      </div>
      <div className="field">
        <label htmlFor="method">Vers</label>
        <select id="method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="payout-phone">Numéro qui reçoit l&apos;argent</label>
        <div className="phone">
          <span className="prefix" aria-hidden="true">+243</span>
          <input id="payout-phone" className="input tnum" type="tel" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <button className="btn btn-primary btn-lg" type="submit" disabled={busy} aria-busy={busy || undefined}>Retirer{amount ? ` ${formatMoney(amount, currency)}` : ""}</button>
    </form>
  );
}

/** Rafraîchit la page tant qu'un retrait est en cours. */
export function PayoutsLive({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
