"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, safeNext } from "./api";
import { OtpInput } from "./OtpInput";
import { maskPhone } from "@/lib/phone";

type Step = "phone" | "code" | "name";

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ phone: string; devCode?: string }>("/auth/otp", { body: { phone: phoneInput } });
      setPhone(r.phone);
      setDevCode(r.devCode);
      setCode("");
      setStep("code");
      setCooldown(30);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(c: string, displayName?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/auth/otp/verify", { body: { phone, code: c, displayName } });
      router.replace(safeNext(next));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "NAME_REQUIRED" && !displayName) {
        setStep("name");
      } else {
        setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
        if (err instanceof ApiError && (err.code === "OTP_WRONG" || err.code === "OTP_EXPIRED")) setCode("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      {step === "phone" && (
        <form className="stack" onSubmit={sendCode} noValidate>
          <div className="field">
            <label htmlFor="phone">Numéro de téléphone</label>
            <div className="phone">
              <span className="prefix" aria-hidden="true">+243</span>
              <input
                id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="81 234 5678"
                value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)}
                aria-invalid={error ? true : undefined} aria-describedby={error ? "phone-err" : "phone-hint"} autoFocus
              />
            </div>
            <span id="phone-hint" className="hint">Nous t&apos;envoyons un code par SMS.</span>
            {error && <span id="phone-err" className="error" role="alert">{error}</span>}
          </div>
          <button className="btn btn-primary btn-lg" type="submit" aria-busy={busy || undefined} disabled={busy}>Recevoir le code</button>
        </form>
      )}

      {step === "code" && (
        <div className="stack">
          <div className="field">
            <label id="otp-label">Code reçu par SMS</label>
            <span className="hint">Envoyé au {maskPhone(phone)}</span>
            <OtpInput
              value={code} onChange={setCode} onComplete={(c) => verify(c)} label="Code à 6 chiffres"
              invalid={!!error} autoFocus describedBy={error ? "otp-err" : undefined}
            />
            {error && <span id="otp-err" className="error" role="alert">{error}</span>}
          </div>
          {devCode && (
            <div className="banner warn" role="note">
              <div><strong>Mode démonstration</strong>Le code est <b className="tnum">{devCode}</b>. Aucun SMS n&apos;est envoyé.</div>
            </div>
          )}
          <button className="btn btn-primary btn-lg" type="button" disabled={busy || code.length < 6} aria-busy={busy || undefined} onClick={() => verify(code)}>
            Valider
          </button>
          <div className="rowflex" style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setStep("phone"); setError(null); }}>Changer de numéro</button>
            <button className="btn btn-ghost btn-sm" type="button" disabled={cooldown > 0 || busy} onClick={() => sendCode()}>
              {cooldown > 0 ? `Renvoyer dans ${cooldown} s` : "Renvoyer le code"}
            </button>
          </div>
        </div>
      )}

      {step === "name" && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); verify(code, name); }} noValidate>
          <div className="field">
            <label htmlFor="name">Comment t&apos;appeler ?</label>
            <input
              id="name" className="input" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
              aria-invalid={error ? true : undefined} aria-describedby={error ? "name-err" : "name-hint"} autoFocus
            />
            <span id="name-hint" className="hint">Ce nom sera visible des acheteurs et des vendeurs.</span>
            {error && <span id="name-err" className="error" role="alert">{error}</span>}
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy} aria-busy={busy || undefined}>Créer mon compte</button>
        </form>
      )}
    </div>
  );
}
