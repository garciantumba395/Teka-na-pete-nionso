# Journal de construction

Jalon : **M0, tranche verticale** (voir `replica/architecture.md`). Date : 2026-11-27.
Couche de données : **PostgreSQL** disponible (`DATA_LAYER=pg`, voir `replica/backend.md`) ; la couche factice reste la valeur par défaut en développement.
Paiement mobile money et SMS : **toujours factices** (aucun PSP ni fournisseur SMS choisi).

## Écrans

| ID | Écran | État | Ce qui manque | Plus dur que prévu |
| --- | --- | --- | --- | --- |
| S01 | Accueil / fil | **fait** | Cœur et compteur de favoris, ligne vendeur, carrousels personnalisés | Rien |
| S02 | Connexion par téléphone | **fait** | Vrai envoi SMS (le code est affiché en mode démonstration) | Gestion du focus au clavier après un code faux : le focus se perdait quand les cases se désactivaient |
| S03 | Catalogue et recherche | partiel | Filtres taille, marque, état ; carte ; tri | Rayon par commune plutôt que par position GPS : pas de permission de géolocalisation à demander |
| S04 | Fiche article | **fait** | Favoris, signalement, offre de prix | Rien |
| S05 | Création d'annonce | partiel | Écran de prise de photo dédié, enregistrement de brouillon, modification d'une annonce publiée, matières, couleurs | Compression côté client à écrire soi-même (taille et GPS) ; validation partagée entre client et serveur |
| S06 | Lot d'articles | non construit | Aucune interface (le serveur accepte déjà plusieurs articles du même vendeur) | |
| S07 | Messagerie | stub | Tout (M1) | |
| S08 | Paiement | **fait** | Vrai PSP | Paiement asynchrone : attente de validation sur le téléphone, refus, paiement tardif |
| S09 | Suivi de commande | **fait** (remise en main propre) | Étapes coursier, litige, avis | Code de remise : voir « Écarts » ci-dessous |
| S10 | Étiquette et dépôt | stub | Tout (M2) | |
| S11 | Litige | stub | Tout (M1) | |
| S12 | Retour | stub | Tout (M3) | |
| S13 | Avis | stub | Tout (M1) | |
| S14 | Profil public | **fait** (basique) | Avis reçus, abonnés | Rien |
| S15 | Mon profil | partiel | Modifier le profil, paramètres, mode économie de données | Rien |
| S16 | Portefeuille et retrait | **fait** | Vrai PSP ; retraits échoués : seulement le recrédit | Rien |
| S17 | Favoris | stub | Tout (M3) | |
| S18 | Compte Pro | stub | Tout (M4) | |
| S19 | Signalement | stub | Tout (M1) | |
| S20 | Pages légales | stub | Texte à faire écrire après avis juridique | |

**10 écrans sur 20 construits ou partiels, 9 en stub, 1 non construit.** Toutes les routes répondent, y compris les stubs.

## Fonctionnalités

Voir `replica/features.csv`. Parité : **39,9 / 100**, **10 des 24 must-haves faits**, 14 oui et 14 partiels sur 51 lignes comptées. L'outil dit lui-même : « pas livrable » (14 must-haves restants : messagerie, litiges, avis, signalement, livraison par coursier…).

## Vérifications

- **55 tests unitaires** (Vitest) : domaine, grand livre, machine d'états, code de remise, couche de données, sécurité.
- **Parcours E2E** (Playwright, `npm run e2e`) : **59 vérifications** sur un vrai serveur de production, à 390 et 1440 px : inscription au clavier, vente avec photos, réservation concurrente, paiement mobile money factice, refus de paiement, code de remise (mauvais code, bon code), libération, retrait, annulation avec remboursement, codes HTTP 404 et 307, aucune erreur console, aucun défilement horizontal.
- Captures : `replica/clone-screens/` (18 fichiers), prises à la hauteur réelle de la page.
- Schéma SQL : `replica/db/` (inchangé depuis la correction des coordonnées).

## Défauts trouvés par l'E2E et corrigés

1. **Toute erreur métier devenait un 500.** Next.js empaquette la couche de données et les routes dans des bundles séparés : la classe d'erreur existait en deux exemplaires et `instanceof` échouait. Correction : `isAppError()` reconnaît l'erreur par ses propriétés, avec un test dédié. Aucun test unitaire ne pouvait le voir.
2. **Codes HTTP faux** : `/items/inexistant` répondait 200 et les pages protégées redirigeaient côté client au lieu d'un 307. Cause : un `loading.tsx` à la racine force le flux, donc le code HTTP part avant la décision. Correction : le squelette de chargement ne couvre plus que l'accueil et la recherche (groupe de routes `(browse)`).
3. **Focus perdu au clavier** après un code faux (cases désactivées pendant l'envoi). Correction : les cases restent actives, le focus revient sur la première.
4. **Visuels** : puces soulignées, pastille de statut étirée, trait du total coupé, « Marie K.. », étiquettes de photos tronquées. Corrigés.
5. **Capture pendant le chargement** et barres fixes au milieu des captures : script de capture corrigé.

## Écarts avec l'architecture (à relire)

- **Code de remise** : la base ne stocke que son empreinte, mais l'acheteur doit pouvoir le revoir. Le code est donc **dérivé** de l'identifiant de commande par HMAC avec un secret serveur (`src/lib/handover.ts`). Conséquence : ce secret doit être fixé et protégé en production ; le changer invalide les codes en cours.
- **Paiement tardif** : `architecture.md` disait « on rouvre la commande si l'article est libre ». Le trigger de la base interdit `expired → paid`, donc la version construite **rembourse automatiquement** et n'empoche jamais l'argent. Réouverture possible plus tard si on autorise cette transition.
- **Route ajoutée** : `GET /orders/{id}/handover-code` (acheteur seulement), absente du tableau d'API initial.
- **Réservation à la création de la commande** : un acheteur peut bloquer un article 15 minutes sans payer. Risque d'abus (blocage répété). À traiter avant la mise en production : limitation de débit, plafond de réservations simultanées par membre.

## Dette et points ouverts

- **Valeurs PLACEHOLDER** (non décidées, ne viennent pas de Vinted) : frais de protection 5 % (minimum 0,50 $), frais de retrait 1 %, plafond 1 000 USD, taux 1 USD = 2 800 FC, délai de paiement 15 min, minimum de retrait. Toutes dans `src/lib/fees.ts`.
- **Couche factice** : état en mémoire, perdu au redémarrage ; session par cookie signé (HMAC), à remplacer par Supabase Auth ; SMS non envoyés ; fournisseur de paiement factice (un numéro finissant par `00` simule un refus).
- **Photos de démonstration** : illustrations SVG générées dans le code, aucune image d'un tiers.
- **Tailwind** est configuré avec les jetons mais les pages utilisent surtout `primitives.css` et des styles en ligne basés sur les variables : à homogénéiser.
- **Valeurs en pixels en dur** dans quelques composants (miniatures 56×72, avatars, icônes). Aucune couleur brute : la couleur de la barre du navigateur est lue dans `tokens.json`.
- **PWA** : pas de manifeste ni de service worker ; budget de performance non mesuré sur appareil réel.
- **Accessibilité** : parcours d'inscription et de remise faits au clavier seul ; pas encore d'audit avec un lecteur d'écran.
- **Coordonnées des communes** : centres approximatifs, à vérifier.

## Mise à jour : `/replica-backend` (2026-11-27)

- Couche PostgreSQL complète derrière `DataLayer`, 3 migrations, 131 tests dont **le même contrat de 38 scénarios sur la couche factice et sur PostgreSQL**, parcours E2E de **75 vérifications sur PostgreSQL** (71 sur la couche factice). Détail, décisions et risques : `replica/backend.md`.
- **Défauts trouvés uniquement par la base réelle, corrigés** : retraits jamais terminés et événement du PSP consommé sans effet ; webhook arrivé avant l'écriture de notre référence ; formulaire soumis avant la fin du chargement (saisie perdue : le bouton d'envoi reste inactif jusqu'à l'hydratation).
- **Identifiants** : les données de référence et de démonstration utilisent maintenant des UUID déterministes (`seedId`). Les anciens liens `area-com-gombe` etc. n'existent plus.
- **Écarts avec l'architecture** : authentification maison (OTP SMS + sessions en base) au lieu de Supabase Auth ; accès à la base par le serveur seulement, RLS activée sans politique ; photos en base ; frais lus depuis `settings`. Raisons dans `backend.md`.
- **Reste à la charge de l'équipe** : PSP, fournisseur SMS, projet de base de données, secrets, avis juridique. Le serveur **refuse de servir** en production tant que ce n'est pas branché.

## Mise à jour : `/replica-test` (2026-11-27)

- Suite Playwright de **95 tests** (`e2e/`), plan dans `replica/test-plan.md`, défauts dans `replica/bugs.md` : **10 trouvés et corrigés, aucun S1 ouvert**. Réussie à 100 % sur la couche factice (92 + 3 ignorés) et sur PostgreSQL (93 + 2 ignorés).
- Les plus utiles : horloge du téléphone fausse (impossible de payer), texte invalide stocké (erreur d'hydratation pour tous les visiteurs, 500 sur PostgreSQL), POST en `text/plain` accepté, lien d'évitement sans effet, débordement à 320 px.

## Mise à jour : `/replica-build`, tranche 1 (2026-11-27)

| ID | Écran | État | Ce qui manque | Plus dur que prévu |
| --- | --- | --- | --- | --- |
| S07 | Messagerie | **fait** (texte) | Photos dans les messages, offres de prix, notification de nouveau message, temps réel (interrogation toutes les 4 s) | Rien de technique ; la détection de numéros sans bloquer demande des règles prudentes (une date ou un prix ne doivent pas être signalés) |

- Conversation rattachée à une annonce, une par couple (annonce, acheteur) ; ouverture idempotente (index unique en base), 404 pour tout tiers, 409 si c'est sa propre annonce ou si l'interlocuteur a supprimé son compte.
- Limites : 30 ouvertures par heure et 40 messages par 10 minutes et par membre.
- Heure des messages affichée dans un fuseau fixe (Africa/Kinshasa), sinon le serveur et le navigateur ne s'accordent pas (erreur d'hydratation).
- Tests : 6 scénarios de contrat sur les deux couches, 3 tests unitaires de détection, 10 cas e2e (`f05-messages.spec.ts`), 3 écrans dans l'audit d'accessibilité.

## Mise à jour : `/replica-build`, tranche 2 (2026-11-27)

| ID | Écran | État | Ce qui manque | Plus dur que prévu |
| --- | --- | --- | --- | --- |
| S11 | Litige | **fait** | Photos en preuve, décision partielle, délai de réponse automatique, notification | Le code de remise libère l'argent tout de suite : le litige ne peut donc exister qu'AVANT la remise (voir ci-dessous) |
| S13 | Avis | **fait** | Réponse à un avis, signalement d'un avis, moyenne pondérée | Rien |
| S19 | Signalement | **fait** | Notification de l'auteur, blocage permanent, délai de 24 h pour corriger une annonce masquée | La suspension doit couper les sessions ET refuser les actions à la reconnexion |
| S03 | Recherche | **fait** (sauf tri, matière, couleur, carte) | Tri, carte | Comparaison sans accent ni casse identique entre les deux couches |
| `/staff` | Espace assistance | **fait** (minimal) | Historique, recherche, statistiques | Rôles : un membre ordinaire reçoit 404, pas 403, pour ne pas révéler l'existence de l'écran |

**Décisions à relire**
- **« Libération après 48 h » n'existe pas telle quelle.** Chez l'original, l'argent est libéré 2 jours après la livraison d'un colis. Ici la remise se fait en main propre avec un code : le code vaut acceptation et libère l'argent immédiatement. La fenêtre de 48 h n'a donc rien à protéger. À la place : (1) litige possible tant que la commande n'est pas remise, (2) **remboursement automatique** d'une commande payée jamais remise au bout de 7 jours (PLACEHOLDER, `settings.unhanded_order_days`), via la tâche `refund_unhanded_orders`.
- **Risque ouvert** : un acheteur peut recevoir l'article, ne pas donner le code et annuler pour être remboursé (l'annulation avant remise reste unilatérale). Le vendeur peut ouvrir un litige et l'assistance tranche, mais rien n'empêche l'annulation avant. À arbitrer : retirer l'annulation unilatérale de l'acheteur après paiement au profit du litige ?
- **Comptes d'assistance de démonstration** : 4 numéros (`089 999 9991` à `…994`, code `123456`), créés seulement par le seed de démonstration, interdit en production. En production, l'attribution d'un rôle se fait en base (`update profiles set role = 'support' where id = …`) : aucun écran ni route ne le permet.
- **Migration 0004** : colonne `seq` sur les messages et les échanges de litige. Deux écritures dans la même milliseconde avaient un ordre d'affichage aléatoire (UUID).
- Tests : 24 scénarios de contrat de plus (sur les deux couches), 31 tests e2e, 4 écrans de plus dans l'audit d'accessibilité.
