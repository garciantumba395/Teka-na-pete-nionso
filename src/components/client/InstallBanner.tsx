"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icons";

// Invitation à installer l'application : discrète, refermable, jamais bloquante.
// Rien ne dépend du navigateur au premier rendu (le serveur et le client rendent « rien ») : l'état n'est lu qu'après l'hydratation.

const KEY = "install-banner-dismissed";
const REPEAT_AFTER_MS = 30 * 86_400_000; // une fois refermée, l'invitation ne revient pas avant 30 jours

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const readDismissed = (): boolean => {
  try {
    const at = Number(localStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < REPEAT_AFTER_MS;
  } catch {
    return false;
  }
};
const writeDismissed = () => {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* navigation privée ou stockage bloqué : l'invitation reviendra, sans conséquence */
  }
};

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);

export function InstallBanner() {
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || readDismissed()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault(); // on garde l'événement pour l'ouvrir au clic ; sinon le navigateur afficherait sa propre invitation
      setDeferred(e as InstallPromptEvent);
      setMode("prompt");
    };
    const onInstalled = () => setMode("hidden");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (isIos()) setMode("ios"); // Safari n'envoie pas l'événement : on explique le geste à la place
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden") return null;

  const close = () => {
    writeDismissed();
    setMode("hidden");
  };
  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* choix annulé ou navigateur qui refuse : on referme simplement */
    }
    setDeferred(null);
    close();
  };

  return (
    <section className="banner info install-banner" aria-label="Installer l'application">
      <Icon name="info" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Installe l&apos;appli sur ton téléphone</strong>
        {mode === "prompt" ? (
          <span>Elle s&apos;ouvre en un geste et charge plus vite, même quand le réseau est lent.</span>
        ) : (
          <span>
            Touche le bouton Partager de ton navigateur, puis « Ajouter à l&apos;écran d&apos;accueil » : elle s&apos;ouvrira comme une appli.
          </span>
        )}
        {mode === "prompt" && (
          <button type="button" className="btn btn-primary btn-sm" onClick={install} style={{ marginTop: "var(--space-8)" }}>
            Installer
          </button>
        )}
      </div>
      <button type="button" className="iconbtn" onClick={close} aria-label="Fermer l'invitation à installer l'application">
        <Icon name="x" />
      </button>
    </section>
  );
}
