"use client";

import { EmptyState } from "@/components/ui";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page narrow">
      <EmptyState
        icon="info"
        title="Quelque chose s'est mal passé"
        action={<button className="btn btn-primary" onClick={() => reset()}>Réessayer</button>}
      >
        Ce n&apos;est pas de ta faute. Vérifie ta connexion puis réessaie.
      </EmptyState>
    </div>
  );
}
