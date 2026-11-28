"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { PhotoAttach } from "./PhotoAttach";
import { ViewablePhoto } from "./PhotoView";
import { useHydrated } from "./useHydrated";
import { DISPUTE_REASONS } from "@/lib/copy";
import { MAX_EVIDENCE_PER_MEMBER } from "@/lib/photos";
import type { DisputeEvidence, DisputeNote } from "@/lib/types";

const fmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });

/** Ouverture d'un litige : motif guidé, puis description. */
export function DisputeForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      await api(`/orders/${orderId}/dispute`, { body: { reason, description } });
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...(err.details ?? {}), form: err.details ? "" : err.message });
      else setErrors({ form: "Erreur inattendue." });
      setBusy(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: "var(--space-8)" }} aria-describedby={errors.reason ? "reason-err" : undefined}>
        <legend className="h2" style={{ marginBottom: "var(--space-8)" }}>Que s&apos;est-il passé ?</legend>
        {DISPUTE_REASONS.map((r) => (
          <label key={r.value} className="row" style={{ display: "flex", gap: "var(--space-12)", alignItems: "flex-start", cursor: "pointer" }}>
            <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} style={{ marginTop: 4 }} />
            <span><strong style={{ display: "block" }}>{r.label}</strong><span className="hint">{r.hint}</span></span>
          </label>
        ))}
        {errors.reason && <span id="reason-err" className="error" role="alert">{errors.reason}</span>}
      </fieldset>
      <div className="field">
        <label htmlFor="desc">Décris la situation</label>
        <textarea id="desc" className="input" rows={5} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={errors.description ? true : undefined} aria-describedby={errors.description ? "desc-err" : "desc-hint"} />
        <span id="desc-hint" className="hint">Le montant reste bloqué pendant que l&apos;assistance examine ta demande. Ne remets rien et ne paie rien en dehors de l&apos;appli.</span>
        {errors.description && <span id="desc-err" className="error" role="alert">{errors.description}</span>}
      </div>
      {errors.form && <span className="error" role="alert">{errors.form}</span>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={busy || !hydrated} aria-busy={busy || undefined}>Ouvrir le litige</button>
    </form>
  );
}

/** Échanges d'un litige : les deux parties et l'assistance. */
export function DisputeThread({ disputeId, notes, open }: { disputeId: string; notes: DisputeNote[]; open: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/disputes/${disputeId}/notes`, { body: { note } });
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-labelledby="thread">
      <h2 id="thread" className="h2">Échanges</h2>
      {notes.length === 0 ? <p className="hint" style={{ margin: 0 }}>Aucun message pour l&apos;instant.</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-8)" }}>
          {notes.map((n) => (
            <li key={n.id} className={`bubble ${n.staff ? "system" : n.mine ? "mine" : "theirs"}`} style={{ maxWidth: "100%" }}>
              <strong>{n.mine ? "Toi" : n.authorName}</strong>
              <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{n.note}</span>
              <time className="bubble-time tnum" dateTime={new Date(n.createdAt).toISOString()}>{fmt.format(n.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form className="stack" onSubmit={send}>
          <div className="field">
            <label htmlFor="note">Ajouter un message</label>
            <textarea id="note" className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            {error && <span className="error" role="alert">{error}</span>}
          </div>
          <button className="btn btn-secondary" type="submit" disabled={busy || !hydrated || !note.trim()}>Envoyer</button>
        </form>
      )}
    </section>
  );
}

/** Décision de l'assistance. Confirmation avant d'agir : l'argent bouge. */
export function ResolveDispute({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [outcome, setOutcome] = useState<"refund_buyer" | "release_seller" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!outcome || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/staff/disputes/${disputeId}/resolve`, { body: { outcome, note } });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inattendue.");
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-labelledby="decide">
      <h2 id="decide" className="h2">Décision</h2>
      {!outcome ? (
        <div className="stack">
          <button className="btn btn-secondary" type="button" disabled={!hydrated} onClick={() => setOutcome("refund_buyer")}>Rembourser l&apos;acheteur</button>
          <button className="btn btn-secondary" type="button" disabled={!hydrated} onClick={() => setOutcome("release_seller")}>Payer le vendeur</button>
        </div>
      ) : (
        <div className="banner warn" role="alertdialog" aria-labelledby="confirm-t">
          <div className="stack" style={{ width: "100%" }}>
            <strong id="confirm-t">{outcome === "refund_buyer" ? "Rembourser l'acheteur ?" : "Payer le vendeur ?"}</strong>
            <span>Cette décision est définitive : l&apos;argent bouge tout de suite.</span>
            <div className="field">
              <label htmlFor="rnote">Message aux deux parties (facultatif)</label>
              <textarea id="rnote" className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && <span className="error" role="alert">{error}</span>}
            <div style={{ display: "flex", gap: "var(--space-8)" }}>
              <button className="btn btn-primary" type="button" onClick={confirm} disabled={busy}>Oui, confirmer</button>
              <button className="btn btn-ghost" type="button" onClick={() => setOutcome(null)} disabled={busy}>Revenir</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- agent B : photos de preuve et de messagerie
/** Section « Preuves » : grille de photos des deux parties et de l'assistance, et ajout d'une photo avec une note. */
export function DisputeEvidencePanel({ disputeId, evidence, open }: { disputeId: string; evidence: DisputeEvidence[]; open: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mineCount = evidence.filter((e) => e.mine).length;
  const full = mineCount >= MAX_EVIDENCE_PER_MEMBER;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !photo) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/disputes/${disputeId}/evidence`, { body: { photo, note } });
      setPhoto(null);
      setNote("");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? (err.details?.photo ?? err.message) : "Erreur inattendue.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack" aria-labelledby="evidence">
      <h2 id="evidence" className="h2">Preuves</h2>
      {evidence.length === 0 ? <p className="hint" style={{ margin: 0 }}>Aucune photo pour l&apos;instant.</p> : (
        <ul className="evidence-grid">
          {evidence.map((e) => (
            <li key={e.id}>
              <figure>
                <ViewablePhoto src={e.photoUrl} alt={`Photo de preuve ajoutée par ${e.authorName}`} />
                <figcaption>
                  <strong>{e.mine ? "Toi" : e.authorName}</strong>{" "}
                  <time className="tnum" dateTime={new Date(e.createdAt).toISOString()}>{fmt.format(e.createdAt)}</time>
                  {e.note && <span style={{ display: "block", whiteSpace: "pre-wrap" }}>{e.note}</span>}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
      {open && (full ? (
        <p className="hint" style={{ margin: 0 }}>Tu as ajouté {MAX_EVIDENCE_PER_MEMBER} photos : c&apos;est le maximum pour ce litige.</p>
      ) : (
        <form className="stack" onSubmit={add}>
          <PhotoAttach value={photo} onChange={setPhoto} disabled={busy} label="Ajouter une photo de preuve" />
          <div className="field">
            <label htmlFor="evidence-note">Note sur cette photo (facultatif)</label>
            <textarea id="evidence-note" className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="evidence-hint" />
            <span id="evidence-hint" className="hint">{mineCount}/{MAX_EVIDENCE_PER_MEMBER} photos. Seules les deux parties et l&apos;assistance les voient.</span>
          </div>
          {error && <span className="error" role="alert">{error}</span>}
          <button className="btn btn-secondary" type="submit" disabled={busy || !hydrated || !photo} aria-busy={busy || undefined}>Ajouter la preuve</button>
        </form>
      ))}
    </section>
  );
}
