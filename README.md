# Marketplace de seconde main, pilote RDC

Reconstruction fonctionnelle (clean-room) d'une marketplace de seconde main, adaptée à la RDC : paiement par mobile money avec séquestre, remise en main propre avec code de confirmation, double devise USD et CDF. Le nom commercial est à définir (`NomAppli` est un placeholder).

## État

Jalon **M0 (tranche verticale)** : vendre, acheter, payer, remettre avec le code, retirer.

- **Couche de données** : en mémoire par défaut (démonstration, rien n'est persistant) ou **PostgreSQL** (`DATA_LAYER=pg`).
- **SMS et paiement** : toujours **factices** (aucun fournisseur choisi). Le serveur **refuse de servir en production** tant qu'ils ne sont pas branchés.
- Détails : [`replica/build-log.md`](replica/build-log.md) et [`replica/backend.md`](replica/backend.md) (décisions, sécurité, ce que l'équipe doit fournir).

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

### Avec PostgreSQL

```bash
cp .env.example .env.local                   # puis remplir (aucune valeur n'est fournie)
DATA_LAYER=pg DATABASE_URL=postgres://… npm run db:migrate
DATA_LAYER=pg DATABASE_URL=postgres://… npm run db:seed-demo   # fausses données, JAMAIS en production
DATA_LAYER=pg DATABASE_URL=postgres://… DEV_FIXED_OTP=123456 npm run dev
```

## Vérifier

```bash
npm test                         # tests unitaires et couche factice (les tests PostgreSQL sont ignorés sans base)
npm run test:pg                  # tout, y compris PostgreSQL, sur une base jetable créée puis supprimée
npm run typecheck
npm run build
npm run e2e                      # parcours Playwright contre un serveur lancé (npm run dev), captures dans replica/clone-screens/
```

Le parcours E2E se lance contre `npm run dev` : `npm start` (production) **refuse** volontairement les fournisseurs factices.

## Organisation

| Dossier | Contenu |
| --- | --- |
| `src/app` | Écrans (Next.js App Router) et API `/api/v1` |
| `src/lib` | Domaine : grand livre, machine d'états, code de remise, validation ; `data/fake.ts` (mémoire) et `data/pg/` (PostgreSQL) |
| `db/migrations` | Schéma SQL versionné (`npm run db:migrate`) |
| `src/styles` | Jetons de design (générés depuis `replica/design`, `npm run sync:design`) |
| `replica/` | Analyse, architecture, schéma SQL testé, design system, journal de construction |
| `e2e/` | Parcours de bout en bout |

## Passer en production

La couche PostgreSQL est prête et testée. **Il manque** : un PSP mobile money (choix, contrat, adaptateur), un fournisseur SMS, une base PostgreSQL gérée avec sauvegardes, les secrets, un avis juridique local, et la décision sur les valeurs PLACEHOLDER (`src/lib/fees.ts`, table `settings`). Liste complète, délais et risques ouverts : [`replica/backend.md`](replica/backend.md).
