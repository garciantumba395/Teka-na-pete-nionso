"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, LOCALE_STATUS, asLocale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { api } from "./api";
import { useHydrated } from "./useHydrated";

/**
 * Choix de la langue d'interface. Écrit le cookie (effet immédiat, y compris pour un visiteur), enregistre le choix sur le profil
 * d'un membre connecté (silencieux si non connecté), puis recharge les données de la page.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const id = useId();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);

  async function change(value: string) {
    const next = asLocale(value);
    if (!next || next === locale || busy) return;
    setBusy(true);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    try {
      await api("/me", { method: "PATCH", body: { lang: next }, quiet: true });
    } catch {
      /* visiteur ou réseau : le cookie suffit */
    }
    router.refresh();
    setBusy(false);
  }

  return (
    <div className={compact ? "lang-switch compact" : "lang-switch"}>
      <label htmlFor={id} className={compact ? "sr-only" : undefined}>{t("common.language")}</label>
      <select id={id} className="input" value={locale} disabled={!hydrated || busy} onChange={(e) => void change(e.target.value)}>
        {LOCALES.map((l) => (
          <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}{LOCALE_STATUS[l] === "beta" ? ` (${t("common.beta")})` : ""}</option>
        ))}
      </select>
    </div>
  );
}
