# Backend : état, décisions, et ce qui reste à la charge de l'équipe

Date : 2026-11-27. Couche réelle : **PostgreSQL** (`DATA_LAYER=pg`). Entrées : `replica/architecture.md`, `replica/schema.sql`, `replica/build-log.md`.

## En une page

| | État |
| --- | --- |
| Base de données | **Faite et testée.** 3 migrations versionnées, 33 tables, refus par défaut en RLS, données de référence rejouables |
| Couche de données PostgreSQL | **Faite et testée** : mêmes 38 scénarios que la couche factice, plus 15 propres à la base |
| Sessions, limites de débit, suppression de compte, tâches planifiées, santé | **Faits et testés** |
| Validation des entrées (zod), en-têtes de sécurité, garde de configuration de production | **Faits et testés** |
| **Paiement mobile money réel** | **Non fait.** Aucun PSP choisi ni contracté. Le fournisseur factice reste le seul branché |
| **SMS réels** | **Non fait.** Aucun fournisseur. Le code s'affiche en mode démonstration |
| Projet Supabase / hébergement de la base | **Non créé** (le skill l'interdit : c'est toi qui crées comptes et clés) |
| E-mail, WhatsApp, notifications push, intégrations tierces | Non faits (hors périmètre M0) |

**Le service ne peut pas être mis en production tel quel** : sans PSP ni fournisseur SMS, il refuse de démarrer en production (voir « Garde de production »). C'est voulu.

## Décisions et écarts avec l'architecture

| Sujet | Architecture initiale | Construit | Pourquoi |
| --- | --- | --- | --- |
| Authentification | Supabase Auth, OTP téléphone | **OTP SMS et sessions maison**, en base | À ma connaissance, l'auth par téléphone de Supabase n'accepte qu'un petit nombre de fournisseurs SMS (à vérifier dans leur documentation) et aucun repli WhatsApp ; or la fiabilité des SMS en RDC est un risque identifié. Notre version fonctionne sur n'importe quel PostgreSQL et accepte n'importe quel fournisseur derrière l'interface `SmsProvider`. **Contrepartie** : nous maintenons nous-mêmes le code d'authentification. À rouvrir si un fournisseur SMS compatible est retenu. |
| Autorisations | RLS pour les lectures clients | **Autorisation dans la couche de données** (accès par le serveur seulement) + **RLS activée sans politique** sur toutes les tables | Aucune API publique de base ne doit pouvoir lire ni écrire : sur Supabase, l'API REST expose les tables à la clé « anon ». Les politiques de `schema.sql` sont conservées comme référence si l'on ouvre un jour un accès direct. |
| Connexion à la base | non précisé | **Rôle propriétaire des tables** (ou BYPASSRLS) | La RLS sans politique refuserait tout à un rôle qui n'est pas propriétaire. À configurer côté hébergeur. |
| Photos | Supabase Storage | **Stockage en base (`bytea`)** derrière une route avec cache immuable | Aucun compte de stockage requis. À migrer vers un stockage objet (R2, S3, Supabase Storage) quand le volume le justifie : le contrat `getPhoto` ne change pas. |
| Frais et plafonds | table `settings` | **Lus depuis `settings`** (cache 30 s), valeurs invalides ignorées | Se changent en base, sans redéployer. Les valeurs chargées par défaut restent des **PLACEHOLDERS**. |
| Identifiants | UUID | **UUID déterministes** pour les données de référence | Mêmes identifiants en développement, test et production (liens, tests, E2E). |
| Suppression de compte | non prévue | **Anonymisation** : `profiles.phone` devient nullable, `deleted_at` ajouté | Les commandes passées restent pour la comptabilité ; le numéro est libéré. Exigée par les magasins d'applications. |

## Checklist de sécurité du skill

Coché = prouvé par un test ou une mesure citée. Non coché ou partiel = dit tel quel.

- [x] **Secrets uniquement en variables d'environnement, `.env*` ignorés, rien dans le code navigateur.** `.env.example` sans aucune valeur ; `.env.local` ignoré par git ; **0 occurrence** de secret, de chaîne de connexion ou de bibliothèque `pg` dans `.next/static` (vérifié sur le build final).
- [x] **Entrées validées côté serveur sur chaque route à corps** (zod) : connexion, code, profil, annonce, commande, paiement, remise, retrait, webhook. Les identifiants d'URL invalides donnent un 404, jamais une erreur serveur. *Limite* : les paramètres de recherche (`GET /items`) sont lus et bornés à la main, pas par zod.
- [x] **Autorisation vérifiée à chaque lecture et écriture, testée avec un second utilisateur.** Suite de contrat « un second utilisateur n'obtient rien » : ni voir, ni payer, ni annuler, ni valider, ni lire le code, ni réutiliser une clé d'idempotence (sur les deux implémentations).
- [x] **Limites de débit** sur l'envoi et la vérification des codes (par adresse hachée et par numéro haché), la création de commande (frein au blocage d'articles), le paiement, le retrait, la création d'annonces. Mesuré en E2E : 429 avec `Retry-After`. *À ajouter* : plafond **global** quotidien de SMS (voir risques).
- [~] **Webhooks : signature vérifiée** sur le corps brut, événements idempotents, référence inconnue non consommée (le PSP peut rejouer). **Partiel** : seule la signature HMAC générique du fournisseur factice est implémentée ; chaque vrai PSP a son propre schéma, à écrire avec son adaptateur.
- [~] **Envois de fichiers : taille et type limités** (450 Ko décodés, 20 photos, type déduit du **contenu**, une fausse image est refusée, en-têtes `nosniff` et CSP `sandbox`). **Partiel** : servis depuis la même origine, pas depuis un domaine ou un bucket séparé.
- [x] **Aucune donnée personnelle dans les URL ni les journaux.** Adresses IP stockées uniquement en empreinte tronquée (vérifié en base : 0 IP et 0 numéro en clair dans `rate_limits`) ; numéros masqués dans le journal SMS ; jetons de session et codes SMS stockés en empreinte (vérifié). *Réserve* : en mode développement, le fournisseur « console » écrit le code SMS dans le journal (interdit en production).
- [x] **Dépendances auditées** : `npm audit` → 0 vulnérabilité (prod et développement).
- [ ] **Politique de confidentialité listant chaque sous-traitant** : non faite (l'écran S20 est un stub). Nécessite l'avis d'un juriste local. Les sous-traitants à lister : hébergeur de la base et de l'application, fournisseur SMS, PSP.

Autres points de la section « Auth » du skill :
- [x] Sessions : cookie `HttpOnly`, `SameSite=Lax`, préfixe `__Host-` et `Secure` en production, jeton opaque, empreinte seule en base. « Se déconnecter partout » **révoque côté serveur** (vérifié : la session d'un second appareil devient invalide).
- [x] Suppression de compte qui supprime réellement les données personnelles (anonymisation du profil, sessions, favoris, appareils, notifications, pièces d'identité) ; refusée s'il reste une commande ouverte ou de l'argent.
- [ ] Réinitialisation de mot de passe, lien magique, OAuth : **sans objet** (identité = téléphone).

## Garde de production

`src/lib/config.ts` + `src/instrumentation.ts`. En production, le serveur **répond 500 à tout** et liste dans son journal chaque problème si l'un de ceux-ci est vrai (vérifié sur le build) :

- `DATA_LAYER` n'est pas `pg` ; `DATABASE_URL` absente ;
- `HANDOVER_SECRET`, `OTP_SECRET`, `CRON_SECRET` absents, de moins de 24 caractères, ou à leur valeur de développement ;
- `PAYMENT_PROVIDER=fake` (sauf `ALLOW_FAKE_PAYMENTS=1`, à ne jamais utiliser avec de vrais clients) ;
- `SMS_PROVIDER=console` ; `DEV_FIXED_OTP` défini.

`GET /api/health` teste réellement la base (200 ou 503, sans détail public).

## Ce que l'équipe doit fournir

À faire **par une personne**, dans cet ordre de délai décroissant. Rien de cela ne peut être fait à ta place.

| # | Élément | Détail | Délai probable |
| --- | --- | --- | --- |
| 1 | **Choix et contrat du PSP** | Évaluer PawaPay, Flutterwave, CinetPay, MaxiCash, intégrations directes (couverture RDC par opérateur non vérifiée). Vérifier : collecte et **décaissement** en USD et CDF, **remboursement**, webhooks signés, sandbox, frais, délais de règlement, plafonds, séquestre. La vérification de l'entreprise (KYB) est souvent la plus longue. | **semaines** (à lancer en premier) |
| 2 | **Avis juridique local** | Détention de fonds clients, statut d'établissement de paiement, protection des données, conditions d'utilisation, politique de confidentialité. | semaines |
| 3 | **Fournisseur SMS** | Choisir, contracter, obtenir les identifiants d'expéditeur autorisés en RDC (règles à vérifier), tester la délivrabilité sur les 4 opérateurs. Prévoir un repli (WhatsApp ou appel vocal). | jours à semaines |
| 4 | **Base PostgreSQL gérée** | Créer le projet (région à mesurer depuis Kinshasa), activer **sauvegardes quotidiennes et restauration à un instant donné**, **tester une restauration**, créer le rôle de l'application (propriétaire des tables ou BYPASSRLS), récupérer la connexion directe (migrations) et celle du pooler. | jours |
| 5 | **Secrets** | `openssl rand -base64 32` pour `HANDOVER_SECRET`, `OTP_SECRET`, `CRON_SECRET`, `PSP_WEBHOOK_SECRET`, chacun distinct, par environnement. `HANDOVER_SECRET` : **ne jamais le changer** avec des commandes en cours (les codes de remise deviendraient invalides). | heures |
| 6 | **Hébergement** | Un proxy de confiance qui **écrase** `x-forwarded-for` (sinon la limite par adresse est contournable) ; HTTPS ; planification des tâches (tableau ci-dessous). | jours |
| 7 | **Adaptateurs** | Écrire l'adaptateur `PaymentProvider` du PSP choisi et l'adaptateur `SmsProvider` ; les faire passer par la suite de contrat contre le bac à sable du fournisseur. **À faire une fois 1 et 3 décidés** : écrire un adaptateur de mémoire, sans documentation ni bac à sable, serait dangereux. | jours, après 1 et 3 |
| 8 | **Supervision** | Alertes sur les requêtes ci-dessous et sur `/api/health`. | jours |

### Tâches planifiées

L'ordonnanceur appelle `GET` ou `POST /api/internal/jobs/<nom>` avec `Authorization: Bearer <CRON_SECRET>`. **Sans `CRON_SECRET` les routes sont fermées (503).**

| Tâche | Fréquence | Rôle |
| --- | --- | --- |
| `expire_unpaid_orders` | 5 min | Libère les articles des commandes non payées |
| `reconcile_pending_payments` | 5 min | Rattrape un webhook perdu en interrogeant le PSP ; abandonne les demandes jamais confirmées |
| `purge_expired` | quotidienne | Supprime codes SMS, sessions et compteurs expirés |
| `all` | à la demande | Exécute les trois |

### Requêtes de surveillance

```sql
-- 1. Le grand livre doit toujours être équilibré (doit retourner 0 ligne)
select currency, sum(amount_minor) from ledger_entries group by currency having sum(amount_minor) <> 0;

-- 2. Paiements bloqués depuis plus de 15 minutes
select id, status, created_at from payments
 where status in ('initiated','pending_user') and created_at < now() - interval '15 minutes';

-- 3. Commandes payées sans remise associée (doit retourner 0 ligne)
select o.id from orders o left join shipments s on s.order_id = o.id
 where o.status in ('paid','in_delivery') and s.id is null;

-- 4. Remboursements refusés par le PSP, à relancer à la main
select created_at, meta from audit_log where action = 'refund_failed' order by created_at desc;

-- 5. Rapprochement : psp_clearing doit correspondre au solde chez le PSP
select currency, sum(amount_minor) from ledger_entries where account = 'psp_clearing' group by currency;
```

## Opérer

```bash
DATABASE_URL=<connexion directe> npm run db:migrate   # applique les migrations (rejouable, verrouillé, sommes de contrôle)
DATABASE_URL=<…> npm run db:seed                      # zones, catégories, paramètres (rejouable)
npm run db:status                                     # migrations appliquées
npm run test:pg                                       # 131 tests, sur une base jetable créée puis supprimée
```

- Les migrations sont **en avant seulement** : modifier une migration déjà appliquée est refusé (somme de contrôle). On écrit une nouvelle migration. Toute nouvelle table doit recevoir `enable row level security` dans sa migration.
- Ne **jamais** lancer `db:seed-demo` en production (il refuse de s'exécuter si `NODE_ENV=production`).

## Risques ouverts (non traités)

1. **Fraude au SMS (« SMS pumping »)** : un attaquant peut déclencher des envois vers des numéros qu'il contrôle, et le coût est pour nous. Les limites par adresse et par numéro aident, mais il faut un **plafond global quotidien** et une alerte de dépense.
2. **Retrait vers n'importe quel numéro** : un compte compromis peut retirer l'argent vers un autre numéro. Piste : limiter les retraits au numéro vérifié, ou exiger un second code pour tout nouveau numéro, plus un délai avant le premier retrait.
3. **Frais du PSP à régler** : le compte `psp_fees` s'alimente à chaque retrait mais n'est jamais soldé. À traiter avec le modèle de facturation du PSP.
4. **Remboursements chez le PSP** : si l'appel échoue après l'écriture comptable, il est seulement journalisé dans `audit_log` (requête 4). Une file de relance automatique reste à faire.
5. **CSP** : `script-src 'unsafe-inline'` (hydratation de Next.js). Une CSP à nonce via un middleware est l'amélioration prévue.
6. **Photos en base** : pratique pour démarrer, coûteuse en volume et en sauvegardes. Migrer vers un stockage objet avant la croissance.
7. **Pooler en mode transaction** : les verrous consultatifs transactionnels et les transactions fonctionnent ; les migrations exigent une connexion directe.
8. **Pas de double authentification, pas de détection d'appareil inhabituel.**
9. **Le fournisseur factice reste utilisable avec `ALLOW_FAKE_PAYMENTS=1`** : drapeau explicite, mais dangereux. Ne jamais le définir avec de vrais clients.

## Ce qui a été vérifié, et comment

| Vérification | Résultat |
| --- | --- |
| Tests unitaires et de contrat | **131 tests** : domaine 22, sécurité 9, configuration 9, contrat de données **38 sur la couche factice et 38 sur PostgreSQL**, propres à PostgreSQL 15 |
| Concurrence réelle sur PostgreSQL | 8 acheteurs simultanés : un seul gagne ; commandes croisées : pas d'interblocage ; deux retraits simultanés : un seul passe ; même webhook en double : encaissé une fois |
| Tests qui testent vraiment | **Mutation** : sans le verrou sur les retraits, deux retraits passent (double dépense démontrée) → le test échoue ; sans l'enregistrement du compteur d'essais → le test échoue |
| Parcours bout en bout | **75 vérifications sur PostgreSQL**, 71 sur la couche factice : inscription, vente, achat, paiement, remise par code, retrait, annulation, 404 et 307, cookie opaque, révocation de session, limite de débit, tâches protégées, en-têtes des photos, suppression de compte |
| Audit de la base après le parcours | Somme du grand livre = 0 ; séquestre = 0 ; solde vendeuse = 14,90 $ ; 3 webhooks traités sur 3 ; aucun article « réservé » orphelin ; secrets en empreinte ; aucune IP ni numéro en clair |
| Build de production | Sans erreur ; refuse de servir avec la configuration par défaut |

**Bugs que seule la base réelle a révélés** (corrigés) : les retraits ne se terminaient jamais (le fournisseur n'était pas enregistré) et l'événement du PSP était alors **consommé sans effet** ; un webhook arrivant avant l'écriture de notre référence aurait été perdu de la même façon ; un formulaire soumis avant la fin du chargement de la page perdait la saisie.

**Non vérifié** : tout ce qui dépend d'un vrai PSP, d'un vrai fournisseur SMS, d'un vrai hébergeur (latence depuis Kinshasa, pooler, restauration de sauvegarde), et la montée en charge.
