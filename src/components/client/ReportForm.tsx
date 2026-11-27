"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";
import { REPORT_REASONS } from "@/lib/copy";

export function ReportForm({ targetType, targetId, targetLabel, back }: { targetType: "item" | "user"; targetId: string; targetLabel: string; back: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!reason) { setError("Choisis un motif."); return; }
    setBusy(true);
    setError(null);
    try {
      await api("/reports", { body: { targetType, targetId, reason, details } });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="stack" role="status">
        <div className="banner ok"><div><strong>Merci, c&apos;est signalé.</strong>Notre équipe va regarder. Tu n&apos;as rien d&apos;autre à faire.</div></div>
        <button className="btn btn-secondary" type="button" onClick={() => router.push(back)}>Retour</button>
      </div>
    );
  }
  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="reason">Pourquoi signaler « {targetLabel} » ?</label>
        <select id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">Choisis un motif</option>
          {REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="details">Précisions (facultatif)</label>
        <textarea id="details" className="input" rows={4} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </div>
      {error && <span className="error" role="alert">{error}</span>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !hydrated} aria-busy={busy || undefined}>Envoyer le signalement</button>
    </form>
  );
}

export function ReportActions({ reportId, canHide }: { reportId: string; canHide: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "dismiss" | "hide_item" | "suspend_user") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/staff/reports/${reportId}`, { body: { action } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>
      <button className="btn btn-ghost" type="button" disabled={busy || !hydrated} onClick={() => act("dismiss")}>Classer sans suite</button>
      {canHide && <button className="btn btn-secondary" type="button" disabled={busy || !hydrated} onClick={() => act("hide_item")}>Masquer l&apos;annonce</button>}
      <button className="btn btn-secondary" type="button" disabled={busy || !hydrated} onClick={() => act("suspend_user")}>Suspendre le membre 7 jours</button>
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}
