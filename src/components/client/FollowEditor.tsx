"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { FOLLOW_KIND_LABEL, FOLLOW_MAX, FOLLOW_VALUE_MAX, type Follows, type FollowKind } from "@/lib/discovery";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";

/** Ajout et retrait des marques OU des tailles suivies (un éditeur par type). Alimente la section « Pour toi » de l'accueil. */
export function FollowEditor({ kind, initial }: { kind: FollowKind; initial: string[] }) {
  const hydrated = useHydrated();
  const [list, setList] = useState(initial);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const names = FOLLOW_KIND_LABEL[kind];
  const field = `follow-${kind}`;
  const atMax = list.length >= FOLLOW_MAX;

  async function call(method: "POST" | "DELETE", v: string, done: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      const r = await api<{ follows: Follows }>("/me/follows", { method, body: { kind, value: v } });
      setList(kind === "brand" ? r.follows.brands : r.follows.sizes);
      setStatus(done);
      return true;
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "UNAUTHENTICATED")) setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) {
      setError(`Écris une ${names.one}.`);
      return;
    }
    if (await call("POST", v, `${names.one === "marque" ? "Marque" : "Taille"} ajoutée : ${v}.`)) setValue("");
  }

  return (
    <div className="stack">
      {list.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Aucune {names.one} suivie pour l&apos;instant.</p>
      ) : (
        <ul className="follow-list" aria-label={`${names.many[0].toUpperCase()}${names.many.slice(1)} suivies`}>
          {list.map((v) => (
            <li key={v}>
              <button type="button" className="chip" disabled={!hydrated} onClick={() => call("DELETE", v, `Tu ne suis plus ${v}.`)} aria-label={`Ne plus suivre ${v}`}>
                {v} <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint" style={{ margin: 0 }}>{list.length} sur {FOLLOW_MAX}</p>
      <form className="follow-add" onSubmit={add} noValidate>
        <div className="field">
          <label htmlFor={field}>Ajouter une {names.one}</label>
          <input
            id={field} className="input" value={value} maxLength={FOLLOW_VALUE_MAX[kind]} autoComplete="off"
            onChange={(e) => setValue(e.target.value)} disabled={atMax}
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${field}-err` : undefined}
            placeholder={kind === "brand" ? "Par exemple : Zara" : "Par exemple : M ou 38"}
          />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={!hydrated || busy || atMax}>Suivre</button>
      </form>
      {atMax && <p className="hint" style={{ margin: 0 }}>Tu suis déjà {FOLLOW_MAX} {names.many}. Retires-en une pour en ajouter.</p>}
      {error && <span id={`${field}-err`} className="error" role="alert">{error}</span>}
      <span className="sr-only" role="status" aria-live="polite">{status}</span>
    </div>
  );
}
