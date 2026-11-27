# Marketplace de seconde main, pilote RDC

Reconstruction fonctionnelle (clean-room) d'une marketplace de seconde main, adaptée à la RDC : paiement par mobile money avec séquestre, remise en main propre avec code de confirmation, double devise USD et CDF. Le nom commercial est à définir (`NomAppli` est un placeholder).

## État

Jalon **M0 (tranche verticale)** : vendre, acheter, payer, remettre avec le code, retirer. Couche de données **factice** (en mémoire) : rien n'est persistant, aucun SMS ni paiement réel. Détails : [`replica/build-log.md`](replica/build-log.md).

## Lancer

```bash
npm install
npm run dev          # http://localhost:3100
```

Comptes de démonstration (le code SMS affiché à l'écran est `123456`) :

| Rôle | Numéro |
| --- | --- |
| Vendeuse | `081 000 0001` |
| Acheteur | `082 000 0002` |

Un numéro de paiement finissant par `00` simule un refus ; tout autre est accepté après ~3 s.

## Vérifier

```bash
npm test                         # tests unitaires (Vitest)
npm run typecheck
npm run build && npm start       # serveur de production sur :3100
npm run e2e                      # parcours Playwright (serveur lancé), captures dans replica/clone-screens/
```

## Organisation

| Dossier | Contenu |
| --- | --- |
| `src/app` | Écrans (Next.js App Router) et API `/api/v1` |
| `src/lib` | Domaine : grand livre, machine d'états, code de remise, validation, couche de données factice |
| `src/styles` | Jetons de design (générés depuis `replica/design`, `npm run sync:design`) |
| `replica/` | Analyse, architecture, schéma SQL testé, design system, journal de construction |
| `e2e/` | Parcours de bout en bout |

## Passer en production

Remplacer la couche factice par l'implémentation réelle (Supabase + PSP) derrière l'interface `DataLayer` de `src/lib/data/types.ts` : c'est l'objet de `/replica-backend`. Avant cela : avis juridique local sur la détention de fonds, choix du PSP, décision sur les valeurs marquées PLACEHOLDER dans `src/lib/fees.ts`.
