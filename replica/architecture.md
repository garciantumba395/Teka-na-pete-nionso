# Architecture : marketplace de seconde main, pilote RDC (reconstruction des fonctions de Vinted)

Entrées : `replica/recon.md`, `replica/features.csv`. Sorties : ce document, `replica/schema.sql` (testé), `replica/db/` (tests).
Date : 2026-11-27. Nom du produit : à définir à l'étape `/replica-brand`.

## Statut des informations

- **Sourcé** : les règles métier tirées des pages publiques de Vinted (voir `recon.md`, balises `[SRC]`).
- **Décision d'architecture** : mon choix, justifié, modifiable.
- **À vérifier** : tout ce qui touche à la RDC (opérateurs, PSP, réglementation, fuseaux, prix). Je n'ai pas pu le confirmer depuis cette session. Rien de la colonne « à vérifier » ne doit être considéré comme acquis avant validation locale.
- Les valeurs de `settings` marquées `PLACEHOLDER` (frais de protection, seuils) sont des points de départ, **pas** les chiffres de Vinted, que je n'ai pas pu lire.

## 1. Contraintes RDC qui dictent l'architecture

| Contrainte | Conséquence retenue | Statut |
| --- | --- | --- |
| Le mobile money est le moyen de paiement dominant, la carte est marginale | Pas de Stripe. Une couche `PaymentProvider` (collecte, décaissement, remboursement, webhooks) au-dessus d'un agrégateur mobile money | à vérifier (couverture par opérateur) |
| Économie bi-devise : USD et CDF circulent | Deux devises dès le départ (`CDF`, `USD`), **une devise par commande**, taux figé à la commande | décision |
| Réseau mobile inégal, données coûteuses | PWA légère, compression d'images côté client, envois reprenables, repli par polling si le temps réel coupe | décision |
| Adressage informel | Pas d'adresse postale obligatoire : commune + repère décrit + position GPS facultative | décision |
| Peu de logistique prépayée | MVP en **remise en main propre avec code de confirmation** ; coursiers locaux ensuite | décision |
| Confiance faible, arnaques fréquentes sur les marketplaces informelles | Séquestre dans tous les cas, détection des échanges hors plateforme, vérification par téléphone, litiges guidés | décision |
| Numéro de téléphone = identité | Connexion par OTP (SMS, repli WhatsApp), numéro unique par compte | décision |
| Langues | Français d'abord, i18n dès le premier écran, lingala et swahili ensuite | décision |
| Deux fuseaux en RDC (ouest UTC+1, est UTC+2), pas d'heure d'été | Tout en UTC, fuseau porté par la province (`areas.tz`) | à vérifier (zones IANA) |
| Détenir l'argent des clients est probablement une activité réglementée | **La plateforme ne détient pas les fonds** : ils restent chez le PSP ou un partenaire agréé ; notre grand livre n'est qu'un registre | à valider par un juriste local avant tout code de paiement |

## 2. Stack

| Couche | Choix | Pourquoi | Alternative |
| --- | --- | --- | --- |
| Web | Next.js (App Router) + TypeScript, **PWA** installable | Un seul code pour web et mobile au départ ; pas de frais de store ; Android domine, la PWA y est bien supportée | Remix, SvelteKit |
| Mobile natif | Expo (React Native), **plus tard**, si la PWA limite (notifications, caméra) | Éviter deux stores et deux déploiements avant d'avoir un marché | Kotlin |
| Style | Tailwind + tokens de `replica-design`, police système | Zéro téléchargement de police, bundle léger | CSS modules |
| Base | PostgreSQL sur Supabase | Une seule base ; RLS ; temps réel ; stockage ; auth dans un seul outil | Neon + Auth.js |
| Accès aux données | Kysely ou Drizzle, types générés depuis le schéma ; migrations SQL versionnées | Le schéma SQL est la source de vérité | Prisma |
| Auth | Supabase Auth, connexion **par OTP téléphonique** | Le numéro est l'identité. SMS d'abord, WhatsApp en repli | Clerk |
| Paiements | Interface `PaymentProvider` + **un** agrégateur mobile money | Isole le fournisseur ; on peut en brancher un second sans toucher au métier | intégrations directes opérateurs |
| Notifications | Web push + SMS (événements critiques : paiement, code de remise) + WhatsApp (modèles approuvés) | L'e-mail est peu lu ; le SMS coûte, donc réservé au critique | FCM natif |
| E-mail | Resend ou Postmark, reçus et administration seulement | Canal secondaire | SES |
| Tâches | Inngest (durable, reprises, cron) | Les flux d'argent exigent des reprises fiables et une trace | pg_cron + files Postgres |
| Fichiers | Supabase Storage : bucket public (photos d'articles), bucket **privé** (pièces d'identité, preuves de litige), CDN devant | Les pièces d'identité ne doivent jamais être publiques | Cloudflare R2 |
| Recherche | Postgres : plein texte `simple` + `unaccent` + trigrammes | Suffisant jusqu'à plusieurs centaines de milliers d'annonces ; zéro service en plus | Typesense, Meilisearch |
| Hébergement | Vercel + région Supabase **à mesurer depuis Kinshasa** avant de figer (candidats : Le Cap, Nairobi, Europe) | La latence réelle prime sur l'intuition | Fly, Render |
| Observabilité | Sentry + logs structurés + alertes sur paiements bloqués | Tout incident d'argent doit être vu en minutes | Datadog |
| Admin | Console interne (`/admin`), rôles `moderator`, `support`, `admin` | Litiges, vérifications, modération, rapprochement | Retool |

Une seule base, pas de microservices. Le clone n'a pas besoin de l'architecture de Vinted, seulement de ses fonctions.

## 3. Schéma

**29 tables**, 38 politiques RLS, 88 index. Fichier : `replica/schema.sql`. Accès : **RLS** pour les lectures et les écritures « propriétaire ». Tout ce qui touche à l'argent, aux statuts de commande, à la modération et aux paramètres s'écrit **uniquement côté serveur** (rôle service). Les droits d'écriture clients sont en plus révoqués explicitement, pour ne pas dépendre d'une seule barrière.

| Domaine | Tables |
| --- | --- |
| Géographie | `areas` (pays, 26 provinces, 24 communes de Kinshasa déjà semées) |
| Membres | `profiles`, `pro_profiles`, `identity_verifications` |
| Catalogue | `categories`, `items`, `item_photos`, `favourites` |
| Échanges | `conversations`, `messages`, `offers` |
| Commandes | `orders`, `order_items`, `shipments`, `bumps` |
| Argent | `payments`, `ledger_entries`, `payouts`, `settings`, `exchange_rates` |
| Confiance | `disputes`, `dispute_evidence`, `reviews`, `reports`, `sanctions` |
| Système | `notifications`, `devices`, `webhook_events`, `audit_log` |

**Recherche par rayon** : `items.lat` et `items.lng` stockent une position **approximative**, arrondie côté serveur à 0,01° (≈ 1 km) pour ne jamais exposer l'emplacement exact du vendeur. La fonction `distance_km()` (haversine, sans PostGIS) tranche après un préfiltre par boîte englobante sur l'index `items_geo_idx`.

Les lots (S06) n'ont pas de table propre : une commande de plusieurs articles du même vendeur est un lot.

### Contraintes dures (la base tranche, pas l'interface)

Testées sur PostgreSQL 16 (`replica/db/`) :

| Garantie | Mécanisme |
| --- | --- |
| Deux acheteurs ne peuvent pas réserver le même article | Index unique partiel `order_items (item_id) where is_open` |
| Une commande ne saute pas d'étape | Trigger `orders_guard_transition` (machine d'états) |
| Total = articles + livraison + frais de protection | `check` sur `orders` |
| L'article redevient disponible si la commande est annulée, expirée ou remboursée ; il passe à `sold` à la fin | Trigger `orders_close_items` |
| Le grand livre est toujours équilibré, et jamais modifié | Trigger différé de somme nulle par transaction et devise ; trigger d'interdiction d'`update`/`delete` |
| Un paiement porte sur une commande **ou** une promotion, jamais les deux ni aucune | `check num_nonnulls = 1` |
| Un seul litige ouvert par commande | Index unique partiel sur `disputes` |
| Un webhook rejoué n'est traité qu'une fois | `unique (provider, event_id)` sur `webhook_events` |
| Une opération d'argent rejouée par le client ne double pas | `idempotency_key unique` sur `payments` et `payouts` |
| Le membre ne peut pas se promouvoir ni changer son statut | Droits par colonne sur `profiles` |
| Le client ne publie pas directement une annonce | Politique : seuls les brouillons sont écrits depuis le client ; la publication passe par l'API qui vérifie plafond, catégorie et texte |

### Grand livre (convention : débit positif, crédit négatif ; somme nulle par transaction)

| Événement | Écritures |
| --- | --- |
| Paiement encaissé (total T = articles I + livraison S + frais F) | `psp_clearing +T` ; `order_escrow −T` |
| Libération au vendeur | `order_escrow +T` ; `seller_available −I` ; `shipping_payable −S` ; `platform_revenue −F` |
| Remboursement intégral | `order_escrow +T` ; `psp_clearing −T` |
| Demande de retrait de A (frais P à la charge du vendeur) | `seller_available +(A+P)` ; `payout_pending −A` ; `psp_fees −P` |
| Retrait confirmé | `payout_pending +A` ; `psp_clearing −A` |

Le solde d'un vendeur = somme de ses lignes `seller_available`. Aucune colonne « solde » modifiable.

## 4. API

Préfixe `/api/v1`. Authentification par session Supabase. Rôle : `anon`, `membre`, `partie` (acheteur ou vendeur de la commande), `staff`.
Seules les API officielles et publiques des fournisseurs, avec nos propres clés.

| Méthode chemin | Fait | Qui | Entrée | Sortie | Flux |
| --- | --- | --- | --- | --- | --- |
| POST /auth/otp | Envoie un code OTP (SMS, repli WhatsApp) | anon | téléphone | 204 | inscription |
| POST /auth/otp/verify | Vérifie le code, crée la session | anon | téléphone, code | session | inscription |
| GET /me | Mon profil complet | membre | | profil | tous |
| PATCH /me | Modifie nom, bio, langue, zone, mode vacances | membre | champs | profil | tous |
| POST /me/verification | Dépose une pièce d'identité (bucket privé) | membre | type, fichier | statut | confiance |
| POST /me/pro | Demande un compte Pro | membre | société, immatriculation | statut | F07 |
| GET /members/{id} | Profil public | anon | | profil public | F06 |
| GET /members/{id}/items | Articles d'un membre | anon | curseur | liste | F02 |
| GET /members/{id}/reviews | Avis reçus | anon | curseur | liste | F06 |
| GET /categories | Arbre des catégories | anon | | arbre | F01, F02 |
| GET /areas | Zones (pays, province, commune) | anon | parent | liste | F01, F02 |
| GET /items | Recherche et filtres, y compris par rayon (`lat`, `lng`, `radius_km`) | anon | q, catégorie, taille, marque, prix, état, zone, rayon, tri, curseur | liste | F02 |
| GET /items/{id} | Détail d'une annonce | anon | | annonce, photos, vendeur | F02 |
| POST /items | Crée un brouillon | membre | champs | annonce | F01 |
| PATCH /items/{id} | Modifie une annonce (active : validation serveur) | vendeur | champs | annonce | F01 |
| POST /items/{id}/publish | Valide et publie (plafond, catégorie, texte, photos) | vendeur | | annonce active | F01 |
| DELETE /items/{id} | Retire une annonce | vendeur | | 204 | F01 |
| POST /items/{id}/photos/upload-url | URL d'envoi reprenable | vendeur | taille, type | URL signée | F01 |
| POST /items/{id}/photos | Enregistre une photo envoyée (retire les métadonnées GPS) | vendeur | chemin, position | photo | F01 |
| DELETE /items/{id}/photos/{pid} | Supprime une photo | vendeur | | 204 | F01 |
| PUT, DELETE /items/{id}/favourite | Ajoute ou retire des favoris | membre | | 204 | F02 |
| GET /me/favourites | Mes favoris | membre | curseur | liste | F02 |
| POST /items/{id}/bump | Achète une mise en avant (crée un paiement) | vendeur | palier, moyen de paiement | paiement | F01 |
| GET /conversations | Mes conversations | membre | curseur | liste | F05 |
| POST /items/{id}/conversations | Ouvre une conversation | membre | | conversation | F05 |
| GET /conversations/{id}/messages | Messages (polling par `after`) | partie | after | liste | F05 |
| POST /conversations/{id}/messages | Envoie un message (détection hors plateforme) | partie | texte | message | F05 |
| POST /conversations/{id}/offers | Propose un prix | acheteur | montant | offre | F05 |
| POST /offers/{id}/accept, /decline, /withdraw | Répond à une offre | vendeur ou acheteur | | offre | F05 |
| POST /orders | Devis et création : réserve l'article de façon atomique, fige taux et frais | membre | articles, mode de livraison, zone, repère | commande, total | F02, F04 |
| GET /orders/{id} | Détail et suivi | partie | | commande, expédition | F02 |
| GET /me/orders | Mes commandes | membre | rôle, curseur | liste | F02 |
| POST /orders/{id}/pay | Lance l'encaissement mobile money | acheteur | moyen, numéro | paiement | F02 |
| GET /orders/{id}/payment | État du paiement (polling) | acheteur | | statut | F02 |
| GET /orders/{id}/handover-code | Affiche le code de remise (dérivé, jamais stocké en clair) | acheteur | | code à 6 chiffres | F02 |
| POST /orders/{id}/cancel | Annule (avant paiement, ou remboursement si non expédié) | partie | motif | commande | F02 |
| POST /orders/{id}/ship | Marque comme remis au coursier ou prêt pour la remise | vendeur | coursier, repère | expédition | F01 |
| POST /orders/{id}/confirm-delivery | Confirme avec le code de remise (5 essais maximum) | vendeur ou coursier | code | commande livrée | F01, F02 |
| POST /orders/{id}/accept | L'acheteur accepte l'article : libère les fonds | acheteur | | commande terminée | F02 |
| POST /orders/{id}/issue | Ouvre un litige (dans la fenêtre de réclamation) | acheteur | motif, texte, photos | litige | F03 |
| POST /disputes/{id}/evidence | Ajoute une preuve | partie | fichier, note | preuve | F03 |
| POST /disputes/{id}/respond | Réponse du vendeur | vendeur | texte | litige | F03 |
| POST /disputes/{id}/return/ship | Déclare l'envoi du retour | acheteur | suivi | litige | F03 |
| POST /orders/{id}/reviews | Laisse un avis (commande terminée) | partie | note, texte | avis | F06 |
| GET /wallet | Solde et historique | membre | | solde, écritures | F01 |
| POST /payouts | Demande un retrait | vendeur | montant, moyen, numéro, clé d'idempotence | retrait | F01 |
| GET /payouts | Mes retraits | membre | | liste | F01 |
| POST /reports | Signale un article, un membre ou un message | membre | cible, motif | signalement | F08 |
| GET /notifications | Mes notifications | membre | curseur | liste | tous |
| POST /devices | Enregistre un jeton de notification | membre | jeton, plateforme | 204 | tous |
| GET /admin/disputes | File des litiges | staff | filtres | liste | F03 |
| POST /admin/disputes/{id}/resolve | Tranche : remboursement, libération, partiel | staff | décision, montant | litige | F03 |
| POST /admin/items/{id}/hide | Masque une annonce (délai de correction) | staff | motif | annonce | F08 |
| POST /admin/users/{id}/sanction | Suspend ou bannit | staff | type, durée, motif | sanction | F08 |
| POST /admin/verifications/{id}/review | Valide ou rejette une pièce | staff | décision | statut | confiance |
| GET /admin/reconciliation | Écarts entre notre grand livre et le PSP | staff | date | rapport | argent |

**Webhooks entrants** : `POST /webhooks/psp/{provider}` (collecte, décaissement, remboursement ; signature vérifiée ; écrit d'abord dans `webhook_events`, traite ensuite) ; accusés d'envoi SMS ; plus tard, événements des coursiers.
**Webhooks sortants** : aucun au MVP.

**Tâches planifiées**

| Tâche | Fréquence | Rôle |
| --- | --- | --- |
| `expire_unpaid_orders` | 5 min | Commandes `pending_payment` au-delà du délai : expirées, article libéré |
| `reconcile_pending_payments` | 5 min | Interroge le PSP pour les paiements en `pending_user` qui n'ont pas reçu de webhook |
| `auto_release` | 10 min | Commandes `delivered` sans litige après la fenêtre de réclamation : terminées, fonds libérés |
| `process_payouts` | 5 min | Envoie les retraits `requested`, relance les échecs temporaires |
| `daily_psp_reconciliation` | quotidienne | Compare le relevé du PSP et le grand livre ; alerte sur tout écart |
| `expire_offers` | 15 min | Offres expirées |
| `enforce_fix_deadline` | horaire | Annonces masquées non corrigées dans le délai : retirées |
| `refresh_exchange_rates` | horaire | Taux CDF/USD (source à choisir) |
| `recompute_ratings` | après chaque avis | Recalcule note moyenne et nombre d'avis |
| `purge_identity_documents` | quotidienne | Supprime les pièces d'identité après la rétention |
| `cleanup_orphan_uploads` | quotidienne | Photos envoyées mais jamais rattachées |

## 5. Les parties qui mordent

- **Fuseaux** : deux fuseaux en RDC, pas d'heure d'été. Tout en UTC, affichage selon `areas.tz`. Les échéances (fenêtre de réclamation, expiration) sont calculées en heures, pas en « jours calendaires » ambigus.
- **Idempotence** : un webhook arrive souvent deux fois, un client réessaie un paiement après un coupure réseau. `webhook_events` et `idempotency_key` protègent ; tout traitement de webhook doit être rejouable sans effet de bord.
- **Course sur l'article** : résolue par l'index unique partiel, pas par l'interface. La réservation est une transaction : insertion dans `order_items` puis `items.status = 'reserved'`, ou rien.
- **Mobile money asynchrone** : l'acheteur confirme par code PIN sur son téléphone, parfois après le délai. Un paiement peut réussir **après** l'expiration de la commande. Règle construite : **remboursement automatique** (le trigger de la base interdit `expired → paid`, donc pas de réouverture). Ne jamais empocher un paiement tardif.
- **Code de remise** : 6 chiffres, haché, 5 essais puis verrouillage temporaire. Le code est donné par l'acheteur **après** avoir inspecté l'article. Il vaut acceptation et libère les fonds.
- **Double devise** : une devise par commande, taux figé (`fx_rate_id`). Arrondis du CDF à l'unité entière même si la norme ISO prévoit des centimes. Écarts de change à la charge de qui ? Décision de produit.
- **Frais du mobile money** : les frais de retrait peuvent représenter une part importante d'un petit panier. Ils doivent être modélisés avant de fixer les frais de protection (voir risques).
- **SMS** : délivrabilité inégale selon l'opérateur, risque de détournement de carte SIM. OTP avec limitation de débit, repli WhatsApp, et pas de SMS pour les messages courants (coût).
- **Temps réel fragile** : WebSocket qui coupe. Le client rattrape par polling avec un curseur `after` ; les notifications poussent le reste.
- **Photos** : compression côté client (cible indicative : 1280 px, quelques dizaines à une centaine de Ko), envoi reprenable, suppression des métadonnées GPS (confidentialité), 20 photos maximum.
- **Arnaques** : détection de numéros, liens de paiement et demandes de paiement hors plateforme dans les messages (`messages.flagged`), avertissement visible, pas de blocage automatique au début.
- **Recherche** : `simple` + `unaccent` gère les accents du français ; pour le lingala et le swahili, les trigrammes comblent. Rebâtir sur un moteur dédié si le volume le justifie.
- **Données personnelles** : ne pas supprimer un profil lié à des commandes (`on delete restrict`) ; **anonymiser** à la place. Pièces d'identité en bucket privé, URL signées courtes, purge planifiée. Cadre légal local à valider.
- **Modération** : annonces masquées avec délai de correction (24 h), sanctions graduées, journal d'audit sur toute action du personnel.
- **Multi-locataire** : non applicable (une seule marketplace). Pas de `org_id`.

## 6. Ordre de construction

Les durées sont indicatives, pour une équipe de 3 à 5 personnes ; elles ne comptent ni la contractualisation du PSP ni le juridique, qui sont sur le chemin critique.

| Jalon | Contenu | Écrans | Tables | Routes |
| --- | --- | --- | --- | --- |
| **M0. Tranche verticale** (2 à 3 semaines) | Inscription par OTP, créer une annonce avec photos, la voir, l'acheter en **remise en main propre** avec paiement mobile money (**bac à sable**), code de remise, libération au vendeur, retrait. USD seul, une ville | S02, S05, S04, S01 (liste simple), S08, S09, S16 | `profiles`, `areas`, `categories`, `items`, `item_photos`, `orders`, `order_items`, `shipments`, `payments`, `ledger_entries`, `payouts`, `settings`, `webhook_events` | auth, `/me`, `/items`, `/orders` (create, pay, confirm-delivery, accept), `/wallet`, `/payouts`, webhook PSP |
| **M1. Indispensables** (4 à 6 semaines) | Catalogue et recherche avec filtres, messagerie, litiges de base, avis, profil public, signalements, vérification par téléphone, CDF + USD, i18n français, PWA, console admin minimale | S01, S03, S07, S11, S13, S14, S15, S19 | `conversations`, `messages`, `disputes`, `dispute_evidence`, `reviews`, `reports`, `sanctions`, `notifications`, `devices`, `exchange_rates`, `audit_log` | messagerie, litiges, avis, signalements, admin |
| **M2. Livraison** (3 à 4 semaines) | Coursiers locaux, suivi, colis perdu, relais, repères et position | S10, S12 | `shipments` (étendu) | `/orders/{id}/ship`, suivi |
| **M3. Souhaitables** | Offres, favoris, mises en avant payantes, notifications push et WhatsApp, pièce d'identité, retours | S17 | `offers`, `favourites`, `bumps`, `identity_verifications` | offres, favoris, bump |
| **M4. Facultatifs** | Comptes Pro, statistiques, puis **les correctifs que `/replica-entrepreneur` aura trouvés** | S18 | `pro_profiles` | `/me/pro` |

Porte avant M0 (en parallèle) : choix du PSP et ses conditions, avis juridique sur la détention des fonds, décision sur la ville pilote.

## 7. Risques principaux

| # | Risque | Pourquoi | Atténuation |
| --- | --- | --- | --- |
| 1 | **Paiement et séquestre** | Dépend d'un PSP dont la couverture RDC, le décaissement et le règlement ne sont pas vérifiés ; détention de fonds probablement réglementée | PSP et juriste **avant** M1 ; ne jamais détenir les fonds ; rapprochement quotidien ; M0 en bac à sable |
| 2 | **Économie unitaire** | Les frais mobile money, SMS et WhatsApp peuvent dépasser la marge sur de petits paniers | Modèle financier avant de fixer les frais ; SMS réservé au critique ; plancher de prix par article |
| 3 | **Confiance et fraude** | Remise en main propre = risque physique et hors plateforme ; arnaques au paiement | Code de remise après inspection ; lieux publics suggérés ; détection hors plateforme ; vérification progressive |
| 4 | **Liquidité** | Pas d'offre, pas d'acheteurs, et inversement | Une ville, quelques catégories, recrutement de vendeurs avant le lancement public |
| 5 | **Connectivité** | Une appli lourde est inutilisable | Budget de performance mesuré sur réseau lent, PWA légère |

## Décisions à prendre (par ordre d'impact)

1. **PSP** : lequel évaluer en premier et qui contacte les fournisseurs ? (bloque M0 en production, pas en bac à sable)
2. **Devises du MVP** : USD seul, ou USD + CDF dès M0 ? (le schéma gère les deux ; c'est un choix de produit et de risque de change)
3. **Livraison du MVP** : remise en main propre uniquement, ou un coursier partenaire dès M0 ?
4. **Ville pilote** : Kinshasa seule (communes déjà semées) ou Lubumbashi aussi ?
5. **Modèle de frais** : frais de protection côté acheteur comme Vinted, ou autre schéma, une fois les coûts du PSP connus.

## Étape suivante

`/replica-design` : jetons de design (couleurs, typographie, composants) pour une interface légère, à partir des captures de référence, avec nos propres ressources. Prévoir de fournir des captures publiques de Vinted dans `replica/screens/` ; sans cela, je définis le design système depuis `recon.md` seulement.

## Écarts constatés à la construction

Voir `replica/build-log.md` : code de remise dérivé par HMAC, paiement tardif remboursé, route `handover-code` ajoutée, risque de blocage d'articles par réservation répétée.
