"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "../icons";
import { FEES } from "@/lib/fees";
import { compressImage } from "./image";

export function PhotoPicker({ photos, onChange, error }: { photos: string[]; onChange: (p: string[]) => void; error?: string }) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const remaining = FEES.maxPhotos - photos.length;

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setProblem(null);
    const list = Array.from(files).slice(0, Math.max(0, remaining));
    if (files.length > list.length) setProblem(`Maximum ${FEES.maxPhotos} photos : certaines n'ont pas été ajoutées.`);
    setBusy((b) => b + list.length);
    const added: string[] = [];
    for (const f of list) {
      try {
        if (!f.type.startsWith("image/")) throw new Error("type");
        added.push(await compressImage(f));
      } catch {
        setProblem("Une photo n'a pas pu être lue. Essaie avec une image JPEG ou PNG.");
      } finally {
        setBusy((b) => b - 1);
      }
    }
    if (added.length) onChange([...photos, ...added]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="field">
      <label htmlFor={id}>Photos <span className="hint">({photos.length}/{FEES.maxPhotos})</span></label>
      <div className="photos-strip">
        {photos.map((src, i) => (
          <div className="thumb" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Photo ${i + 1}`} />
            <button type="button" aria-label={`Retirer la photo ${i + 1}`} onClick={() => onChange(photos.filter((_, j) => j !== i))}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
        {Array.from({ length: busy }, (_, i) => (
          <div className="thumb skeleton" key={`b${i}`} role="status" aria-label="Photo en cours de préparation" />
        ))}
        {remaining > 0 && (
          <label className="add" htmlFor={id}>
            <Icon name="cam" size={28} />
            Ajouter
            <input
              id={id} ref={inputRef} className="sr-only" type="file" accept="image/*" multiple
              onChange={(e) => add(e.target.files)} aria-describedby={`${id}-hint`}
            />
          </label>
        )}
      </div>
      <span id={`${id}-hint`} className="hint">
        Photos réduites automatiquement pour économiser tes données. La position GPS des photos est retirée.
      </span>
      {(error || problem) && <span className="error" role="alert">{error ?? problem}</span>}
    </div>
  );
}
