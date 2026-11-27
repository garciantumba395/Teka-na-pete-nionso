"use client";

import { useEffect, useRef } from "react";

/** Saisie d'un code à N chiffres : une case par chiffre, collage du code entier, retour arrière, flèches. */
export function OtpInput({
  value, onChange, onComplete, length = 6, disabled = false, label, invalid = false, autoFocus = false, describedBy,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  length?: number;
  disabled?: boolean;
  label: string;
  invalid?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const prevLen = useRef(value.length);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  // Après une erreur (le parent vide le code), le focus revient sur la première case : pas de perte de focus au clavier.
  useEffect(() => {
    if (value.length === 0 && prevLen.current > 0 && !disabled) refs.current[0]?.focus();
    prevLen.current = value.length;
  }, [value, disabled]);

  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  return (
    <div className="otp" role="group" aria-label={label}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className="input"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          disabled={disabled}
          aria-label={`${label}, chiffre ${i + 1} sur ${length}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (!v) return;
            const arr = digits.slice();
            arr[i] = v[v.length - 1];
            set(arr.join(""));
            if (i < length - 1) focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              const arr = digits.slice();
              if (arr[i]) arr[i] = "";
              else if (i > 0) {
                arr[i - 1] = "";
                focus(i - 1);
              }
              onChange(arr.join("").slice(0, length));
            } else if (e.key === "ArrowLeft") focus(i - 1);
            else if (e.key === "ArrowRight") focus(i + 1);
          }}
          onPaste={(e) => {
            e.preventDefault();
            const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (!pasted) return;
            set(pasted);
            focus(pasted.length >= length ? length - 1 : pasted.length);
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
      ))}
    </div>
  );
}
