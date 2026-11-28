# Brief commun des agents parallèles

À lire en entier AVANT d'écrire du code. Chaque agent travaille dans une copie de travail git isolée, avec ses ports et sa plage de migration.

## Mise en route
1. Ta copie peut avoir démarré sur un « Initial commit » (README seul). Va sur la vraie base : `git reset --hard claude/upbeat-noether-vq7x7j` (la branche existe dans le dépôt partagé). Vérifie avec `ls` que `src/`, `e2e/`, `db/` existent.
2. Dépendances sans réseau : `cp -al /home/user/Teka-na-pete-nionso/node_modules ./node_modules` (repli : `ln -s`).
3. Lis `AGENTS.md` (cette version de Next.js a des changements : lis `node_modules/next/dist/docs/` avant d'écrire du code Next), puis `replica/build-log.md` (dernières sections), `replica/backend.md`, `replica/parity.md`, `replica/bugs.md`.
4. **Tes ports** (donnés dans ta tâche) : `PORT=<p> PG_TEST_PORT=<q> bash scripts/e2e-server.sh fake npx playwright test <fichiers> --reporter=line`, puis `pg` à la place de `fake`. Jamais 3100 ni 5566. Tests unitaires et contrat : `npm run -s test:pg` (base jetable).

## Architecture
- `DataLayer` (`src/lib/data/types.ts`) a DEUX implémentations qui doivent se comporter pareil : `fake.ts` (mémoire) et `pg/data.ts` (PostgreSQL). Le contrat partagé `src/lib/__tests__/contract.ts` tourne sur les deux : tout comportement nouveau y est testé. Les tests propres à PostgreSQL (concurrence, contraintes) vont dans des fichiers `pg.*.test.ts` (voir `pg.idempotency.test.ts`).
- Routes API `src/app/api/v1/**` (zod dans `src/lib/schemas.ts`, `enforce()` pour les limites de débit, `requireUser()`), écrans `src/app/**`, composants client `src/components/client/**`. Erreurs : `AppError`. Argent : entiers en unités mineures, grand livre en partie double toujours équilibré (`src/lib/ledger.ts`).
- Tâches planifiées : `src/lib/jobs.ts` ; si tu en ajoutes une, mets à jour la liste attendue dans `e2e/specs/security.spec.ts` (SEC-7).
- Notifications : `src/lib/notifications.ts` (types, textes, SMS critiques) ; elles sont créées DANS les méthodes DataLayer, dans la même transaction que l'événement.
- Migrations : `db/migrations/NNNN_*.sql`, jamais éditer l'existant, RLS activée sur toute nouvelle table comme en 0003 (et révoquer anon/authenticated). Migrations existantes : 0001 à 0009.

## Règles dures
- Texte d'interface en français, écrit par toi, rien copié d'une autre application. Pas de couleur ni de pixel en dur (variables CSS et classes existantes). Aucun secret ni numéro réel en dur. Jamais de donnée personnelle dans les journaux.
- Accessibilité : labels, focus visible, clavier, `role="alert"` pour les erreurs, boutons d'envoi inactifs avant hydratation (`useHydrated`). Heures affichées en fuseau fixe `Africa/Kinshasa` (sinon erreur d'hydratation). Aucun état dépendant du navigateur dans le rendu serveur.
- Texte libre nettoyé côté serveur (`src/lib/text.ts` via les schémas).
- **Ne modifie PAS** `replica/*.md`, `README.md`, `replica/features.csv` : le chef de projet les consolide. Mets dans ton rapport final : lignes de matrice à changer, notes de journal, risques.
- Ne touche pas à l'interface d'autres fonctionnalités au-delà de ce que ta tâche exige.

## Enseignements de la dernière fois (à appliquer)
- Les e2e utilisent `process.env.BASE_URL` (jamais `localhost:3100` en dur). Les clés d'idempotence de test sont des UUID (`apiPay` le fait). `staffPhone()` (e2e/support.ts) tire un compte d'assistance parmi 20 : l'envoi de code est limité à 3 par numéro et par 10 minutes, donc ne fais pas se connecter l'assistance dans chaque test d'une boucle ; réutilise l'acteur.
- Une course (deux requêtes concurrentes) ne se teste pas en une seule tentative : répète-la en boucle et vérifie que le test ÉCHOUE sans ta correction.
- Les tests e2e qui créent un litige ouvert ou un signalement en attente polluent la file d'assistance lue par d'autres tests : clos ou classe ce que tu crées.
- Pour limiter les conflits de fusion : tes ajouts DataLayer/fake/pg dans des blocs délimités par `// ---- agent <lettre> : <sujet>` ; tes tests de contrat dans un nouveau `describe(...)` à la fin de `contract.ts` ; tes tests e2e dans de NOUVEAUX fichiers de spec ; ton CSS dans un bloc commenté en fin de `globals.css`.
- Un test qui échoue : classe-le (défaut du test ou de l'application) et corrige le bon. Jamais de test sauté ni désactivé pour passer au vert.

## Définition de terminé
`npx tsc --noEmit` propre ; `npm run -s test:pg` vert ; suite e2e COMPLÈTE verte sur la couche factice ET sur PostgreSQL avec tes ports (relance la suite complète APRÈS ta dernière correction, pas seulement le fichier corrigé). Écrans nouveaux ajoutés à `e2e/a11y-screens.ts`. Commits en français dans ta branche (ne pousse rien, pas de PR), terminés par :
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JuujBtrZgeHdL5wUSweWGN

Rapport final (français, court) : branche, fichiers, résultats chiffrés (réussis/échoués/ignorés, factice, PG, contrat), décisions de conception, lignes de matrice, notes de journal, risques restants.
