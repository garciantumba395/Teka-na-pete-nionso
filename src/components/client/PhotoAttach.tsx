"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "../icons";
import { compressImage } from "./image";
import { useHydrated } from "./useHydrated";

/**
 * Choix d'UNE photo à joindre (message, preuve de litige) : bouton accessible au clavier, aperçu, retrait.
 * La photo est réduite et nettoyée de ses métadonnées (GPS compris) avant l'envoi, comme pour les annonces.
 */
export function PhotoAttach({
  value, onChange, disabled = false, label = "Joindre une photo", error,
}: { value: string | null; onChange: (photo: string | null) => void; disabled?: boolean; label?: string; error?: string | null }) {
  const id = useId();
  const hydrated = useHydrated();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    const f = files?.[0];
    if (inputRef.current) inputRef.current.value = ""; // permet de rechoisir le même fichier
    if (!f) return;
    setProblem(null);
    setBusy(true);
    try {
      if (!f.type.startsWith("image/")) throw new Error("type");
      onChange(await compressImage(f));
    } catch {
      setProblem("Cette photo n'a pas pu être lue. Essaie avec une image JPEG ou PNG.");
    } finally {
      setBusy(false);
    }
  }

  const shown = error ?? problem;
  return (
    <div className="attach">
      <input
        id={id} ref={inputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Choisir une photo"
        onChange={(e) => void pick(e.target.files)}
      />
      {value ? (
        <div className="attach-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Aperçu de la photo à envoyer" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)} disabled={disabled}>Retirer la photo</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || busy || !hydrated} onClick={() => inputRef.current?.click()} aria-describedby={shown ? `${id}-err` : undefined}>
          <Icon name="cam" size={20} />
          {busy ? "Préparation de la photo…" : label}
        </button>
      )}
      {busy && <span className="sr-only" role="status">Photo en cours de préparation</span>}
      {shown && <span id={`${id}-err`} className="error" role="alert">{shown}</span>}
    </div>
  );
}
