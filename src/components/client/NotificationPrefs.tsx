"use client";

import { useState } from "react";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";
import { SMS_CATEGORIES, type SmsCategory, type SmsPreferences } from "@/lib/notifications";

export function NotificationPrefs({ initial }: { initial: SmsPreferences }) {
  const hydrated = useHydrated();
  const [prefs, setPrefs] = useState<SmsPreferences>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function change(key: SmsCategory, value: boolean) {
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await api<{ preferences: SmsPreferences }>("/notifications/preferences", { method: "PATCH", body: { [key]: value } });
      setPrefs(r.preferences);
      setStatus("Préférence enregistrée.");
    } catch (e) {
      setPrefs(before);
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} disabled={!hydrated}>
        <legend className="h2">SMS</legend>
        {SMS_CATEGORIES.map((c) => (
          <div key={c.key} className="row">
            <span style={{ minWidth: 0 }}>
              <label htmlFor={`sms-${c.key}`} style={{ fontWeight: 600, display: "block" }}>{c.label}</label>
              <span className="hint" id={`sms-${c.key}-hint`}>{c.hint}</span>
            </span>
            <span className="toggle">
              <input id={`sms-${c.key}`} type="checkbox" role="switch" checked={prefs[c.key]} aria-describedby={`sms-${c.key}-hint`} onChange={(e) => change(c.key, e.target.checked)} />
              <span aria-hidden="true" />
            </span>
          </div>
        ))}
      </fieldset>
      {error && <span className="error" role="alert">{error}</span>}
      <p className="hint" role="status" style={{ margin: 0 }}>{status}</p>
    </div>
  );
}
