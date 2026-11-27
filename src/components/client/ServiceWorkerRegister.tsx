"use client";

import { useEffect } from "react";

const CACHE_PREFIX = "marketplace-";
const FLAG = "sw-dev-optin";

/**
 * Le service worker (public/sw.js) est enregistré :
 *  - toujours en production ;
 *  - en développement SEULEMENT à la demande : `?sw=1` dans l'adresse (valable pour l'onglet, `?sw=0` l'annule) ou
 *    NEXT_PUBLIC_ENABLE_SW=1 au démarrage. Sans cela, `next dev` et les tests de bout en bout n'en voient jamais.
 * En développement sans demande, un service worker resté d'une session précédente est retiré, avec ses caches.
 */
function enabled(): boolean {
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "1") return true;
  try {
    const q = new URLSearchParams(window.location.search).get("sw");
    if (q === "1") sessionStorage.setItem(FLAG, "1");
    if (q === "0") sessionStorage.removeItem(FLAG);
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (enabled()) {
      // updateViaCache: "none" : le fichier du service worker n'est jamais servi depuis le cache HTTP, une mise à jour est vue tout de suite.
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
      return;
    }
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister()));
      void caches?.keys().then((ks) => ks.filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => void caches.delete(k)));
    }
  }, []);
  return null;
}
