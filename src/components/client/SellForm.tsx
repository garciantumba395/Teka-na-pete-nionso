"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { PhotoPicker } from "./PhotoPicker";
import { parseMoneyInput } from "@/lib/money";
import { CONDITIONS, validateListing, type FieldErrors } from "@/lib/validation";
import type { Area, Category, Currency } from "@/lib/types";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <span id={`${id}-hint`} className="hint">{hint}</span>}
      {error && <span id={`${id}-err`} className="error" role="alert">{error}</span>}
    </div>
  );
}

export function SellForm({ categories, areas, defaultAreaId }: { categories: Category[]; areas: Area[]; defaultAreaId: string | null }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [condition, setCondition] = useState("");
  const [sizeLabel, setSizeLabel] = useState("");
  const [brand, setBrand] = useState("");
  const [priceRaw, setPriceRaw] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [areaId, setAreaId] = useState(defaultAreaId ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parents = categories.filter((c) => c.parentId === null);
  const err = (k: keyof FieldErrors) => errors[k];
  const aria = (k: keyof FieldErrors, id: string) => ({ "aria-invalid": err(k) ? true : undefined, "aria-describedby": err(k) ? `${id}-err` : `${id}-hint` });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const priceMinor = parseMoneyInput(priceRaw, currency);
    const input = { title, description, categoryId, condition, sizeLabel, brand, priceMinor: priceMinor ?? NaN, currency, areaId: areaId || null, photos };
    const found = validateListing(input, categories);
    if (priceMinor === null && !found.priceMinor)
      found.priceMinor = currency === "CDF" ? "Indique un prix en francs entiers (ex. 35 000)." : "Indique un prix valide (ex. 12,50).";
    setErrors(found);
    const first = (["photos", "title", "categoryId", "condition", "priceMinor"] as const).find((k) => found[k]);
    if (first) {
      document.getElementById(first === "photos" ? "photos-anchor" : first)?.focus();
      return;
    }
    setBusy(true);
    try {
      const draft = await api<{ item: { id: string } }>("/items", { body: input });
      await api(`/items/${draft.item.id}/publish`, { method: "POST", body: {} });
      router.push(`/items/${draft.item.id}`);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.code === "UNAUTHENTICATED") {
        router.push("/signin?next=/sell");
        return;
      }
      if (e2 instanceof ApiError && e2.details) setErrors(e2.details as FieldErrors);
      setFormError(e2 instanceof ApiError ? e2.message : "Erreur inattendue.");
      setBusy(false);
    }
  }

  const errorCount = Object.keys(errors).length;

  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      {(formError || errorCount > 0) && (
        <div className="banner danger" role="alert">
          <div><strong>{formError ?? "Corrige les champs signalés"}</strong>{errorCount > 0 && `${errorCount} champ${errorCount > 1 ? "s" : ""} à vérifier.`}</div>
        </div>
      )}

      <div id="photos-anchor" tabIndex={-1}>
        <PhotoPicker photos={photos} onChange={setPhotos} error={err("photos")} />
      </div>

      <Field id="title" label="Titre" hint="Ex. : Robe wax manches courtes" error={err("title")}>
        <input id="title" className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} {...aria("title", "title")} />
      </Field>

      <Field id="description" label="Description" hint="État, défauts éventuels, dimensions." error={err("description")}>
        <textarea id="description" className="input" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} {...aria("description", "description")} />
      </Field>

      <Field id="categoryId" label="Catégorie" error={err("categoryId")}>
        <select id="categoryId" className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} {...aria("categoryId", "categoryId")}>
          <option value="">Choisir…</option>
          {parents.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {categories.filter((c) => c.parentId === p.id && c.isSellable).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>

      <Field id="condition" label="État" error={err("condition")}>
        <select id="condition" className="input" value={condition} onChange={(e) => setCondition(e.target.value)} {...aria("condition", "condition")}>
          <option value="">Choisir…</option>
          {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-12)" }}>
        <Field id="sizeLabel" label="Taille (facultatif)" error={err("sizeLabel")}>
          <input id="sizeLabel" className="input" value={sizeLabel} maxLength={20} onChange={(e) => setSizeLabel(e.target.value)} {...aria("sizeLabel", "sizeLabel")} />
        </Field>
        <Field id="brand" label="Marque (facultatif)" error={err("brand")}>
          <input id="brand" className="input" value={brand} maxLength={40} onChange={(e) => setBrand(e.target.value)} {...aria("brand", "brand")} />
        </Field>
      </div>

      <div className="stack">
        <div className="field">
          <span id="currency-label" style={{ font: "600 var(--text-sm-size)/var(--text-sm-line) var(--font-sans)" }}>Devise</span>
          <div className="segmented" role="group" aria-labelledby="currency-label">
            {(["USD", "CDF"] as Currency[]).map((c) => (
              <button key={c} type="button" aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c === "USD" ? "Dollars (USD)" : "Francs (CDF)"}</button>
            ))}
          </div>
        </div>
        <Field id="priceMinor" label={`Prix en ${currency === "USD" ? "dollars" : "francs congolais"}`} hint={currency === "USD" ? "Ex. : 12,50" : "Ex. : 35 000"} error={err("priceMinor")}>
          <input id="priceMinor" className="input tnum" inputMode="decimal" value={priceRaw} onChange={(e) => setPriceRaw(e.target.value)} {...aria("priceMinor", "priceMinor")} />
        </Field>
      </div>

      <Field id="areaId" label="Où remettre l'article ?" hint="Commune. Seule une position approximative est enregistrée." error={err("areaId")}>
        <select id="areaId" className="input" value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-describedby="areaId-hint">
          <option value="">Non précisé</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>

      <button className="btn btn-primary btn-lg" type="submit" disabled={busy} aria-busy={busy || undefined}>Publier l&apos;annonce</button>
    </form>
  );
}
