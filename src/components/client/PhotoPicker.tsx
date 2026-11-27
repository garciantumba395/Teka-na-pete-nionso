"use client";

import { useId, useRef, useState } from "react";
import { Icon } from "../icons";
import { FEES } from "@/lib/fees";

const MAX_EDGE = 1280;
const MAX_CHARS = 550_000; // le serveur refuse au-delà de 600 000 caractères

/**
 * Redessine l'image sur un canvas : réduit la taille (économie de données mobiles) ET supprime toutes les
 * métadonnées, dont la position GPS de la photo (confidentialité du vendeur).
 */
async function compress(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  for (const q of [0.72, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_CHARS) return url;
  }
  throw new Error("trop lourde");
}

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
        added.push(await compress(f));
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
