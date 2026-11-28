# Décision 4 : liste de contrôle de passage en production

Rédigé le 2026-11-28 pour un responsable des opérations IT. Tiré du code (commit `10a8aeb`) et de replica/backend.md. **Rien n'a été exécuté** : les commandes et la requête SQL sont des exemples, avec des marqueurs `<À_REMPLACER>`. Aucun secret n'apparaît ici. « Bloquant » = le serveur refuse de démarrer ou le service est dangereux.

## 1. Variables d'environnement

Modèle : `.env.example` (valeurs vides). Créées par vous chez l'hébergeur, jamais dans le dépôt (`.env.local` est ignoré par git).

| Variable | Obligatoire en production ? | Ce que le garde-fou refuse (src/lib/config.ts) | Remarque |
| --- | --- | --- | --- |
| `NODE_ENV` | doit valoir `production` | si ≠ production, **le garde ne contrôle rien** (config.ts:11) | `next start` le fixe ; vérifier sur l'hébergeur |
| `DATA_LAYER` | oui, `pg` | autre valeur ou absente (« fake » par défaut) : refusé (l.18) | |
| `DATABASE_URL` | oui | absente (l.19) | connexion du **pooler** pour l'application ; connexion **directe** pour les migrations (§2) |
| `DATABASE_CA_CERT` | recommandé | non contrôlé | certificat de l'hébergeur de la base pour vérifier TLS ; ne jamais désactiver la vérification (.env.example:9) |
| `DATABASE_POOL_MAX` | non | non contrôlé | défaut 10 (src/lib/data/pg/pool.ts:16) |
| `HANDOVER_SECRET` | oui | absente, < 24 car. ou valeur de développement (l.20, 13-16) | voir §3 |
| `OTP_SECRET` | oui | idem (l.21) | protège les empreintes des codes SMS |
| `CRON_SECRET` | oui | idem (l.22) | sans lui, les routes de tâches répondent 503 (src/lib/jobs.ts:41) |
| `PAYMENT_PROVIDER` | oui, ≠ `fake` | `fake` refusé sauf `ALLOW_FAKE_PAYMENTS=1` (l.23-24) | décision 1 |
| `PSP_WEBHOOK_SECRET` | oui si fournisseur ≠ fake | absente ou courte (l.25) | décision 1 |
| Clés propres au PSP | oui | **non contrôlées aujourd'hui** | à ajouter au garde avec l'adaptateur |
| `SMS_PROVIDER` | oui, ≠ `console` | `console` ou absente refusé (l.26) | décision 2 |
| Clés propres au SMS | oui | **non contrôlées aujourd'hui** | idem |
| `DEV_FIXED_OTP` | **ne pas définir** | défini : refusé (l.27) | code SMS fixe de démonstration |
| `SMS_CONSOLE_QUIET` | sans objet | — | |
| `ALLOW_FAKE_PAYMENTS` | **ne jamais définir** | le contourne le refus du faux paiement (l.23) | dangereux avec de vrais clients (backend.md, risque 9) |

Comment le garde agit : au démarrage du serveur (src/instrumentation.ts), `assertProductionConfig` lève une erreur qui liste chaque problème ; le serveur **répond 500 à tout** et les problèmes sont dans les journaux (backend.md, « Garde de production »). Il n'agit pas pendant `next build` (instrumentation.ts : `NEXT_PHASE !== "phase-production-build"`).

- [ ] Toutes les variables ci-dessus renseignées dans l'hébergeur (jamais dans le dépôt)
- [ ] Un démarrage de test sur l'environnement de production **sans trafic** : journaux sans « Configuration de production invalide »
- [ ] 4 secrets différents entre eux **et** différents entre préproduction et production, 24 caractères aléatoires minimum
- [ ] `ALLOW_FAKE_PAYMENTS`, `DEV_FIXED_OTP` absentes (recherche dans la console de l'hébergeur)

## 2. Base de données

- [ ] PostgreSQL géré créé ; région choisie après mesure de latence depuis Kinshasa (non vérifiée ; backend.md, « Non vérifié »)
- [ ] **Sauvegardes quotidiennes** et **restauration à un instant donné** activées chez l'hébergeur
- [ ] **Une restauration testée** sur une base vide (durée notée : ______ ; perte maximale acceptable, RPO : ______)
- [ ] Rôle de l'application = **propriétaire des tables** (ou BYPASSRLS) : la sécurité par ligne est activée **sans politique** sur toutes les tables, donc un rôle non propriétaire ne verrait rien (backend.md, « Connexion à la base »)
- [ ] Connexion **directe** (pas le pooler en mode transaction) utilisée pour les migrations
- [ ] Migrations 0001 à 0009 appliquées : `DATABASE_URL=<CONNEXION_DIRECTE> npm run db:migrate` puis `npm run db:status` (les migrations sont en avant seulement et protégées par somme de contrôle : on n'en modifie jamais une appliquée)
- [ ] Données de référence : `DATABASE_URL=<…> npm run db:seed` (zones, catégories, paramètres, règles d'articles interdits). Rejouable (`on conflict do nothing`, src/lib/data/pg/seed.ts:42-44)
- [ ] **Paramètres à fixer en base**, car les valeurs chargées sont des PLACEHOLDERS (seed.ts : `_placeholder: true`) : frais de protection acheteur, frais de retrait, valeur maximale d'un article, grille de livraison, délais. Table `settings` (clés : `buyer_protection`, `payout_fee`, `max_item_value_usd_minor`, `order_payment_ttl_minutes`, `handover_max_attempts`, `handover_lock_minutes`, `max_photos`, `claim_window_hours`, `courier_stale_days`, `shipping_grid`, et, **non présentes dans le seed**, `unhanded_order_days`, `cancel_request_days` : src/lib/data/pg/settings.ts:23-37). Cache de 30 s : un changement s'applique sans redéployer
- [ ] Volume : les **photos sont en base** (`bytea`) : surveiller la taille et le coût des sauvegardes ; plan de migration vers un stockage objet (backend.md, risque 6)
- [ ] Alerte sur la taille de la base et sur le nombre de connexions

## 3. Secrets : conséquences d'un changement

| Secret | Si on le change | Procédure |
| --- | --- | --- |
| `HANDOVER_SECRET` | les codes de remise sont **dérivés** de lui (src/lib/handover.ts:9-13) : tous les codes affichés aux acheteurs changent. Les commandes **payées ou en livraison** pour lesquelles l'empreinte du code est déjà stockée (`handover_code_hash`, data.ts:1114) ne correspondent plus au nouveau code : **remise impossible, litige probable**. Ne **jamais** le changer en cours d'usage | si fuite : attendre qu'il n'y ait plus de commande payée ou en livraison (requête ci-dessous), ou traiter chaque commande ouverte à la main |
| `OTP_SECRET` | les codes SMS en attente deviennent invalides (5 min de durée de vie) ; sans autre effet | changer pendant un moment calme ; les utilisateurs redemandent un code |
| `CRON_SECRET` | l'ordonnanceur échoue (401) jusqu'à mise à jour de son en-tête | mettre à jour l'ordonnanceur **avant ou en même temps** |
| `PSP_WEBHOOK_SECRET` | les webhooks du PSP sont rejetés (401) jusqu'à synchronisation avec le tableau de bord du PSP | rotation coordonnée ; le PSP rejoue ses événements |
| `DATABASE_URL` | perte de connexion | rotation du mot de passe en deux temps |

Requête (exemple, lecture seule, **non exécutée**) : commandes empêchant un changement de `HANDOVER_SECRET`.
```sql
select count(*) from orders where status in ('paid','in_delivery','delivered');
```

- [ ] Procédure écrite de rotation, avec qui peut la déclencher
- [ ] Où sont stockés les secrets (coffre de l'hébergeur) et qui y a accès : ______

## 4. Ordonnanceur (tâches planifiées)

L'ordonnanceur externe (Vercel Cron, Inngest, cron système) appelle `GET` ou `POST /api/internal/jobs/<nom>` avec l'en-tête `Authorization: Bearer <CRON_SECRET>` (src/app/api/internal/jobs/[name]/route.ts ; src/lib/jobs.ts:40-46). Sans secret : 503 ; mauvais secret : 401. Le paramètre de test `asOf` est refusé en production (jobs.ts:30-38).

Liste **exacte** des tâches (src/lib/jobs.ts:15-26), et celle attendue par le test de sécurité SEC-7 (e2e/specs/security.spec.ts:111) :

| Tâche | Ce qu'elle fait | Fréquence conseillée | Limite par exécution |
| --- | --- | --- | --- |
| `expire_unpaid_orders` | expire les commandes non payées au bout de 15 min et libère les articles | toutes les 5 minutes | — |
| `reconcile_pending_payments` | interroge le PSP pour les paiements « initiés » ou « en attente » de plus de 2 min ; abandonne ceux sans référence (`PROVIDER_TIMEOUT`) | toutes les 5 minutes | 200 paiements (data.ts:655-658) |
| `refund_unhanded_orders` | rembourse les commandes payées jamais remises après 7 jours (PLACEHOLDER) | toutes les heures | — |
| `release_delivered_orders` | libère au vendeur les livraisons par coursier dont les 48 h de réclamation sont écoulées, sans litige | toutes les 15 à 30 minutes | 200 commandes (data.ts:1741-1742) |
| `refund_stale_courier_orders` | rembourse les colis « remis au coursier » depuis plus de 10 jours | toutes les heures | — |
| `purge_old_notifications` | supprime les notifications lues depuis plus de 90 jours | quotidienne (nuit) | — |
| `purge_expired` | supprime codes SMS, sessions et compteurs expirés | quotidienne (nuit) | — |
| `all` | exécute **toutes** les tâches ci-dessus, **séquentiellement** | à la demande ; ne remplace pas la fréquence de 5 minutes de deux d'entre elles | — |

Remarques :
- Le tableau de backend.md (3 tâches) est **périmé** : le code en compte 7. Ne pas planifier d'après lui.
- Les tâches doivent pouvoir se chevaucher sans danger (les écritures sont verrouillées et revérifiées, data.ts:1745-1747), mais ne pas lancer deux ordonnanceurs en parallèle par prudence.
- Un retard de `reconcile_pending_payments` prolonge l'attente des acheteurs dont le webhook a été perdu.

- [ ] 7 tâches programmées (ou `all` toutes les 5 minutes, si l'on accepte que les purges tournent aussi souvent)
- [ ] Alerte « tâche non exécutée depuis ______ minutes »
- [ ] Test : appel sans secret = 401 ; avec secret = 200 et JSON `{job, result}`
- [ ] Si l'ordonnanceur est un tiers : le secret n'apparaît pas dans ses journaux

## 5. Rôle « support » à attribuer en base

Aucun écran ne permet de donner un rôle : l'attribution se fait **en base**, par une personne autorisée (build-log.md, « Comptes d'assistance »). Rôles possibles : `member`, `moderator`, `support`, `admin` (db/migrations/0001_core.sql:48). Le rôle est lu à chaque requête à partir de `profiles` (data.ts:577-578), donc l'effet est immédiat, sans reconnexion. Un membre ordinaire reçoit 404 sur `/staff` (build-log.md).

Procédure : la personne s'inscrit normalement par SMS (vrai numéro, code reçu), puis un administrateur de la base exécute (**exemple, jamais exécuté ; remplacer les marqueurs ; une transaction**) :

```sql
begin;
-- 1. Vérifier que le compte visé est le bon (doit retourner exactement UNE ligne)
select id, display_name, role, status from profiles
 where phone = '<NUMÉRO_E164_À_REMPLACER>' and deleted_at is null;

-- 2. Attribuer le rôle
update profiles set role = 'support'
 where id = '<ID_UUID_DU_COMPTE_À_REMPLACER>' and deleted_at is null;

-- 3. Garder une trace
insert into audit_log (actor_id, action, target_type, target_id, meta)
values (null, 'role_granted', 'profile', '<ID_UUID_DU_COMPTE_À_REMPLACER>',
        '{"role":"support","by":"<NOM_DE_L_ADMINISTRATEUR_À_REMPLACER>","reason":"<MOTIF_À_REMPLACER>"}');
commit;
```

- [ ] Au moins **2 personnes** avec le rôle `support` (continuité), 1 avec `admin`
- [ ] Comptes d'assistance sur des **numéros professionnels** dédiés, pas des numéros personnels
- [ ] Retrait du rôle documenté (même requête avec `'member'`)
- [ ] Les 20 comptes d'assistance de démonstration (numéros « 089 999 99xx », src/lib/data/seed.ts:81-82) **n'existent pas** en production : requête de contrôle `select count(*) from profiles where role <> 'member';` doit montrer uniquement les comptes voulus
- [ ] Les agents d'assistance connaissent la procédure de litige (décision 3, §D) et ne partagent pas leur compte

## 6. Seed de démonstration : interdit

`npm run db:seed-demo` crée de faux membres, de fausses annonces et des comptes d'assistance connus. Le refus est dans `seedDemo` (src/lib/data/pg/seed.ts:49) et **ne dépend que de `process.env.NODE_ENV === "production"` dans le shell qui lance la commande** : lancée depuis un poste avec la base de production dans `DATABASE_URL` et sans `NODE_ENV=production`, elle **s'exécuterait**.

- [ ] Procédure : ne **jamais** avoir `DATABASE_URL` de production dans un `.env.local` de poste de développement
- [ ] Les commandes de production se lancent depuis un environnement où `NODE_ENV=production` est défini
- [ ] Contrôle après chaque migration : `select count(*) from profiles where phone in ('+243810000001','+243820000002','+243990000003') or phone like '+24389999%';` (doit retourner 0 ; ce sont les numéros de démonstration de src/lib/data/seed.ts:78-82, à comparer avec vos vrais numéros avant d'exécuter)
- [ ] `DEV_FIXED_OTP` jamais défini (le code fixe est en outre ignoré en production : data.ts:115)
- [ ] Proposition à Claude (après décision) : durcir `db.ts seed-demo` pour qu'il exige un indicateur explicite de développement

## 7. Supervision

`GET /api/health` : teste réellement la base (`select 1`) ; 200 `{"status":"ok"}` ou 503 `{"status":"unavailable"}` sans détail, `Cache-Control: no-store` (src/app/api/health/route.ts).

- [ ] Sonde externe toutes les minutes sur `/api/health`, alerte après 2 échecs
- [ ] Alerte sur les 5 requêtes de surveillance de backend.md, exécutées par un outil (toutes les 5 à 15 min) :
  1. grand livre non équilibré (doit retourner 0 ligne) ;
  2. paiements bloqués depuis plus de 15 minutes ;
  3. commandes payées sans remise associée ;
  4. remboursements refusés par le PSP (`audit_log.action = 'refund_failed'`) : **relancer à la main**, aucune relance automatique ;
  5. rapprochement du compte `psp_clearing` avec le solde chez le PSP (quotidien).
- [ ] Alerte de dépense SMS et plafond global (décision 2, §7) : **non codés**
- [ ] Alerte sur les erreurs 5xx et les journaux `[refund]`, `[pay]`, `[sms]` (les messages n'ont pas de données personnelles)
- [ ] Journaux : durée de conservation ______ ; accès limité ; vérification qu'aucun numéro ni code n'apparaît
- [ ] Page d'état ou canal d'information pour les utilisateurs en cas de panne SMS/PSP
- [ ] Hébergeur : proxy de confiance qui **écrase** `x-forwarded-for`, sinon la limite par adresse est contournable (src/lib/ratelimit.ts:5-10) ; HTTPS ; domaine

## 8. Plan de retour arrière

| Situation | Action |
| --- | --- |
| Mauvais déploiement de l'application | redéployer la version précédente (garder les 3 dernières ; l'hébergeur doit le permettre) ; **la base n'est pas revenue en arrière** |
| Migration défectueuse | les migrations sont en avant seulement : écrire une **nouvelle** migration corrective ; sinon restaurer la sauvegarde (perte des données depuis). Toujours : sauvegarde manuelle **avant** `db:migrate` |
| Le PSP renvoie des erreurs | suspendre les paiements (maintenance), laisser tourner `reconcile_pending_payments`, communiquer ; les paiements non confirmés expirent et se remboursent seuls en cas de paiement tardif |
| SMS en panne | personne ne peut se connecter : prévoir le message de panne ; **pas de repli codé** |
| Fuite de secret | rotation selon §3 ; invalider les sessions : `delete from sessions` (exemple, déconnecte tout le monde) |
| Données corrompues ou grand livre déséquilibré | arrêter les paiements et retraits, restaurer à un instant précédent sur une **copie**, comparer, puis décider |
| Arrêt du service | message d'arrêt, remboursement des fonds en séquestre, export des données (obligations : décision 3) |

- [ ] Procédure testée à blanc (déploiement précédent) : date ______
- [ ] Contact d'astreinte, PSP, hébergeur, SMS : numéros d'urgence listés
- [ ] Fonctionnalité d'interrupteur (« maintenance », arrêt des retraits) : **absente du code** ; peut être demandée à Claude

## 9. Tests manuels sur vrai téléphone

À faire sur au moins : un Android d'entrée de gamme, un Android récent, un iPhone, avec les opérateurs réels. Le service worker, l'installation et la caméra n'ont **jamais** été testés sur un vrai appareil (build-log.md, risques).

**Installation et service worker** (public/sw.js ; politique : réseau d'abord pour les pages, aucune réponse d'API en cache)
- [ ] Page chargée en HTTPS, certificat valide
- [ ] Invite d'installation (Android Chrome) ; sur iPhone : explication « Ajouter à l'écran d'accueil » affichée (pas de `beforeinstallprompt` sur Safari)
- [ ] Icône, nom et couleur de l'application installée corrects (nom de marque encore PLACEHOLDER : src/lib/copy.ts:4)
- [ ] Mode avion : la page `/offline` s'affiche ; aucune page privée n'est visible hors ligne
- [ ] Après déconnexion, les pages privées (commandes, portefeuille, messages) ne sont **pas** lisibles depuis le cache du navigateur ; photos privées : cache `private, max-age=3600` : vérifier sur un appareil partagé
- [ ] Mise à jour : déployer une nouvelle version, rouvrir l'application : la nouvelle version prend la main

**Appareil photo et photos**
- [ ] Prise de photo native depuis le formulaire de vente (champ `accept="image/*"`, src/components/client/PhotoPicker.tsx:57) et depuis un message (PhotoAttach.tsx:41)
- [ ] **Photos HEIC (iPhone)** : le code lit l'image avec `createImageBitmap` (src/components/client/image.ts:9) et la réencode en JPEG ; **aucune gestion explicite de HEIC dans le code** : tester sur iPhone et sur un Android qui produit du HEIC ; si échec : message clair à l'utilisateur
- [ ] Photo très grande (12 Mpx) : redimensionnée à 1 280 px, taille < 450 Ko (limite serveur 450 Ko décodés, 20 photos)
- [ ] GPS : la photo envoyée ne contient plus de position (vérifier avec un lecteur d'EXIF)
- [ ] Annulation de la caméra, permission refusée : message compréhensible

**SMS et paiement réels** (après décisions 1 et 2)
- [ ] Code SMS reçu sur Vodacom, Orange, Airtel, Africell (S1 à S3 de la décision 2)
- [ ] Paiement réel avec montant minimal sur chaque opérateur (R1, R2, R4, R5 de la décision 1)
- [ ] Remboursement reçu sur le téléphone
- [ ] Retrait vers un mobile money réel (R13)
- [ ] Remise en main propre : code à 6 chiffres, 5 essais puis blocage de 15 minutes (fees.ts:31-32)

**Réseau 3G lent / coupures**
- [ ] Throttling 3G (outil du navigateur) puis **réseau réel en 2G/3G** : l'accueil devient utilisable en moins de ______ s (seuil à fixer)
- [ ] Formulaire soumis pendant le chargement : pas de perte de saisie (bouton inactif avant hydratation)
- [ ] Coupure réseau pendant le paiement : pas de double paiement (clé d'idempotence)
- [ ] Double appui sur « Payer » : un seul paiement
- [ ] Heures affichées au fuseau `Africa/Kinshasa`

**Accessibilité de base** : agrandissement du texte à 200 %, lecteur d'écran sur la connexion et le paiement.

## 10. Que devrait signifier « lancement pilote limité »

Proposition à valider par l'utilisateur ; **ce que le code sait déjà faire** et **ce qu'il ne sait pas**.

| Dimension | Proposition de départ (à décider) | Mécanisme existant dans le code | À écrire (par Claude, après décision) |
| --- | --- | --- | --- |
| Valeur maximale d'un article | par exemple ___ USD (le défaut est 1 000 USD, **trop élevé pour un pilote**) | `max_item_value_usd_minor` en base (settings.ts:23-24), appliqué côté serveur | rien |
| Montant par commande et par jour, par membre | par exemple ___ USD | **aucun plafond de total par membre ou par jour** | plafond par membre et plafond global quotidien de volume |
| Montant maximal d'un retrait ; délai avant le premier retrait | ___ USD ; ___ jours | minimum de retrait seulement (data.ts:1548) ; **pas de plafond ni de délai** | plafond, délai, retrait limité au numéro vérifié (backend.md, risque 2) |
| Nombre de membres | par exemple ___ (50 à 200) | **aucun plafond d'inscription ni liste d'invitation** : l'inscription est libre par SMS | liste d'invitation / codes d'invitation, ou plafond de comptes |
| Communes | par exemple 3 communes de Kinshasa : ______ | table `areas` ; **pas de restriction par zone à l'inscription ni à l'achat** | restriction ou message ; la grille de livraison existe (sameCommune, sameCity, otherCity) |
| Catégories | peu de catégories sans risque | catégories vendables en base (`is_sellable`) | rien (donnée) |
| Modes de livraison | remise en main propre d'abord, coursier ensuite | les deux existent | rien |
| Opérateurs | 1 ou 2 opérateurs prouvés fiables | `PaymentMethod` côté interface | masquer les opérateurs non testés |
| SMS | plafond global ___ SMS/jour | 5 SMS de notification par numéro et par jour (notifications.ts:87) ; **pas de plafond global** | plafond global, alerte (décision 2) |
| Assistance | 2 agents, horaires publiés ; délai de réponse visé ___ h | espace `/staff` minimal | historique, recherche |
| Durée | ___ semaines, puis revue des chiffres | — | — |
| Critères d'arrêt | un seul écart de grand livre, un paiement perdu, un taux de fraude > ___ % | requêtes de surveillance | interrupteur d'arrêt (§8) |
| Texte annoncé aux pilotes | le service est en test, ce qui peut changer, qui contacter | — | page d'information |

Conditions d'entrée du pilote (toutes cochées) :
- [ ] décisions 1, 2 et 3 prises ; conditions d'utilisation et politique de confidentialité publiées
- [ ] recette de paiement R1 à R16 et de SMS S1 à S8 passée
- [ ] sections 1 à 9 de ce document cochées
- [ ] plafonds ci-dessus choisis et en place
- [ ] astreinte nommée pour les 2 premières semaines
