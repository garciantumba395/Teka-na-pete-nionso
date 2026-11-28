import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * Faux tant que la page n'est pas hydratée (rendu serveur et hydratation), vrai ensuite.
 * Les boutons d'envoi restent inactifs jusque-là : sinon, un « Entrée » tapé avant la fin du chargement
 * (réseau lent) déclencherait l'envoi NATIF du formulaire et vider la saisie.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
