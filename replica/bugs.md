# Défauts trouvés par les tests

Build testé : `a00bebe` (corrections) ; défauts constatés sur le build précédent (`replica-backend`). Tous **reproduits par un test automatique** (le test reste dans `e2e/`). Seuls les défauts de l'application figurent ici : les erreurs de test corrigées en route (mauvais sélecteurs, noms trop courts, numéros de test invalides, somme du grand livre non limitée à la commande) n'en sont pas.

| ID | Gravité | Titre | Test | État |
| --- | --- | --- | --- | --- |
| BUG-001 | S2 | Le compte à rebours de paiement se fie à l'heure du téléphone | F02-E7 | corrigé `a00bebe` |
| BUG-002 | S3 | Une annonce au texte invalide casse l'hydratation de l'accueil et de la recherche | F01-E8 + garde console | corrigé `a00bebe` |
| BUG-003 | S3 | Octet nul dans la recherche : erreur 500 sur PostgreSQL | SEC-3 (PG) | corrigé `a00bebe` |
| BUG-004 | S3 | Session expirée en cours de page : pas de retour à la connexion | F02-E9, W-E5 | corrigé `a00bebe` |
| BUG-005 | S3 | Débordement horizontal à 320 px (recherche, fiche, profil) | X-3, F01-E10 | corrigé `a00bebe` |
| BUG-006 | S3 | Le lien « Aller au contenu » ne déplace pas le focus | X-2 | corrigé `a00bebe` |
| BUG-007 | S3 | ARIA invalide et noms accessibles incohérents | X-1 | corrigé `a00bebe` |
| BUG-008 | S4 | Page 404 sans titre de niveau 1 ; rôle `banner` en double | X-1 | corrigé `a00bebe` |
| BUG-009 | S3 | Une requête POST en `text/plain` est acceptée (CSRF par formulaire) | SEC-9 | corrigé `a00bebe` |
| BUG-010 | S4 | Un brouillon au titre trop long est accepté en couche factice, refusé par PostgreSQL | F01-E3 (PG) | corrigé `a00bebe` |

**Aucun S1 ouvert. Aucun défaut ouvert.**

---

### BUG-001 : le compte à rebours de paiement se fie à l'heure du téléphone
- Gravité : **S2** (un acheteur dont l'horloge avance de plus de 15 min ne peut pas payer ; l'argent n'est pas en jeu)
- Flux / cas : F02 / F02-E7 (horloge +2 h et −2 h) · Écran : S08
Étapes : 1. horloge du navigateur avancée de 2 h. 2. acheter un article. 3. ouvrir `/orders/<id>/pay`.
Attendu : « Article réservé encore ~15:00 », formulaire utilisable.
Réel : l'échéance (heure du serveur) est comparée à `Date.now()` du téléphone : compte à rebours à 0:00 et renvoi hors de la page (avance) ; compte à rebours de plus de 2 h (retard).
Cause : `PayForm` calculait `expiresAt - Date.now()` côté client.
Correction : le serveur envoie la **durée restante** (`expiresInMs`) ; le client la décompte avec `performance.now()` (horloge monotone).

### BUG-002 : texte invalide stocké dans une annonce
- Gravité : **S3** · Flux : F01-E8 · Écrans : S01, S03
Étapes : créer une annonce dont la marque contient une demi-paire de substitution (`"Robe\ud800seul"`), la publier, ouvrir l'accueil.
Attendu : aucune erreur. Réel : « Hydration failed because the server rendered text didn't match the client » sur `/` et `/search` pour **tous** les visiteurs tant que l'annonce existe (le HTML serveur écrit U+FFFD, le client garde le caractère).
Même défaut de fond : marques de sens d'écriture (U+202E), caractères de largeur nulle et de contrôle acceptés et affichés (usurpation de texte).
Correction : `src/lib/text.ts` (`cleanLine`, `cleanText`) appliqué par les schémas zod à tous les champs de texte libre et à la recherche ; test unitaire `text.test.ts`.

### BUG-003 : octet nul dans la recherche, 500 sur PostgreSQL
- Gravité : **S3** · Flux : SEC-3 · `GET /api/v1/items?q=%00` → 500 (PostgreSQL refuse `\u0000`, erreur 22021). Invisible en couche factice.
Correction : `q` nettoyé dans l'API et dans la page `/search`.

### BUG-004 : session expirée en cours de page
- Gravité : **S3** · Flux : F02-E9, W-E5 · Écrans : S08, S16
Étapes : ouvrir la page de paiement ou le portefeuille, supprimer le cookie de session, cliquer Payer / Retirer.
Attendu : retour à `/signin?next=<page>`. Réel : message d'erreur générique, l'utilisateur reste bloqué sur la page.
Correction : traitement central du 401 `UNAUTHENTICATED` dans `src/components/client/api.ts`.

### BUG-005 : débordement horizontal à 320 px
- Gravité : **S3** · Flux : X-3, F01-E10 · `/search` : 324 px de contenu pour 320 de fenêtre.
Cause : pistes de grille en `auto` (le contenu impose sa largeur) et colonnes de filtres de 150 px minimum.
Correction : `.page, .stack { grid-template-columns: minmax(0, 1fr) }`, `.page > * { min-width: 0 }`, `minmax(min(150px, 100%), 1fr)`.

### BUG-006 : lien d'évitement sans effet
- Gravité : **S3** · X-2. Au clavier : Tab, Entrée sur « Aller au contenu » : l'URL change mais le focus reste sur `body` ; le Tab suivant repart du haut de page.
Correction : `<main id="main" tabIndex={-1}>`.

### BUG-007 : ARIA invalide
- Gravité : **S3** (axe : 1 critique, 2 sérieux) · X-1
- `aria-pressed` sur un `<span>` (pastille de statut) : critique. `aria-label` sur un `div` sans rôle (grille de chargement). Cartes d'annonce et puce de filtre dont le nom accessible ne contient pas le texte visible (WCAG 2.5.3, commande vocale).
Correction : attributs retirés ; le texte visible fait office de nom ; texte réservé aux lecteurs d'écran pour « retirer ce filtre ».

### BUG-008 : 404 sans titre
- Gravité : **S4** · X-1. La page « Page introuvable » n'avait aucun `h1` ; le rôle `banner` était posé sur chaque barre d'écran. Correction : `EmptyState heading`, rôle retiré.

### BUG-009 : POST en `text/plain` accepté
- Gravité : **S3** (durcissement : le cookie `SameSite=Lax` limite déjà le risque) · SEC-9
Étapes : `POST /api/v1/auth/otp` avec `content-type: text/plain` et un corps JSON. Attendu : refus ; réel : 200. Un formulaire HTML d'un autre site ne peut envoyer que ce type.
Correction : `readJson` exige `application/json` (415 sinon).

### BUG-010 : brouillon au titre hors bornes
- Gravité : **S4** · F01-E3 (PostgreSQL). Titre de 81 caractères : 201 en couche factice, 422 sur PostgreSQL (contrainte 3 à 80). Les deux couches doivent répondre pareil.
Correction : même borne dans le schéma zod à la création.

---

## À vérifier (non reproduit, pas des défauts)

- **Réservation sans paiement** (`build-log.md`) : un acheteur peut bloquer un article 15 min. La limite de 10 commandes par 10 min est testée (SEC-10) ; le plafond de réservations **simultanées** ne l'est pas.
- **Lecteur d'écran réel**, **appareil bas de gamme en 3G**, **appareil photo natif**, **photos HEIC**, **SMS et PSP réels** : voir « À faire à la main » dans `test-plan.md`.
- **Hydratation sous charge** : plus aucune erreur sur 3 exécutions consécutives après BUG-002 ; à surveiller en production avec le journal du navigateur.
