"use client";

import { useRef, useState } from "react";

/**
 * Photo cliquable : un bouton (clavier et lecteur d'écran) ouvre l'agrandissement dans une boîte de dialogue native
 * (piège de focus, Échap pour fermer). L'image agrandie n'est rendue qu'à l'ouverture.
 */
export function ViewablePhoto({ src, alt }: { src: string; alt: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button" className="photo-open" aria-label={`Agrandir : ${alt}`} aria-haspopup="dialog"
        onClick={() => { setOpen(true); ref.current?.showModal(); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" />
      </button>
      <dialog
        ref={ref} className="lightbox" aria-label={alt}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {open && <img src={src} alt={alt} />}
        <button type="button" className="btn btn-secondary" onClick={() => ref.current?.close()}>Fermer</button>
      </dialog>
    </>
  );
}
