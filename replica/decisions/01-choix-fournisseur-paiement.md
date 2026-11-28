# Décision 1 : choix du fournisseur de paiement mobile money

Statut : **à décider par l'utilisateur** (aucun fournisseur contracté). Rédigé le 2026-11-28. Aucun compte créé, aucune API appelée, aucun secret écrit.
Convention : « fichier:ligne » renvoie à la copie de travail au commit `10a8aeb`. Les cellules « à demander » ou vides ne sont **pas** connues : ne rien y inventer.

## 1. Ce qu'on a trouvé sur le web (sources officielles seulement, consultées le 2026-11-28)

| Fait | Source | Limite |
| --- | --- | --- |
| PawaPay documente un bac à sable (« sandbox account »), des remboursements (« Refunds ») et des décaissements (« Payouts »). Elle se présente comme couvrant « 24 African countries, including MTN, M-Pesa, Airtel and Orange ». | https://docs.pawapay.io (page d'accueil de la documentation) | La page ne nomme **pas** la RDC, ni ses opérateurs, ni ses devises, et ne parle pas de signature des rappels. **À demander à PawaPay.** |
| CinetPay publie une documentation d'API (paiement, transfert, notification). Un extrait de recherche mentionnait des lignes « OMCD, MPESACD, AIRTELCD » pour la RDC en CDF, et l'USD Orange « in process ». | https://docs.cinetpay.com/api/1.0-en/checkout/tableau et `/transfert/annexe` | **Pages non ouvertes** (hôte hors du réseau autorisé de la session) : simple extrait de recherche, à relire sur la page. |
| MaxiCash publie une documentation développeur ; un compte marchand donne des identifiants « Live » et « Sandbox » après dossier. | https://developer.maxicashapp.com (extrait de recherche) | Page non ouverte ; opérateurs et devises RDC non confirmés. |
| Flutterwave : aucune page « mobile money RDC » trouvée dans sa documentation (pays listés : francophone, Ghana, M-Pesa, Rwanda, Tanzanie, Ouganda). | https://developer.flutterwave.com/docs/mobile-money/ | Absence dans une recherche, pas preuve d'absence. À demander. |
| Vodacom M-Pesa : le portail officiel trouvé est celui du **Mozambique** (https://developer.mpesa.vm.co.mz). Un tiers affirme que la RDC passe par l'« Open API », sans bac à sable. | Source tierce (docs.centipidbilling.com), **non officielle** | Ne pas s'y fier. Demander à Vodacom RDC. |
| Intégrations directes Orange Money, Airtel Money, Africell Money | — | Rien de vérifié. À demander. |

`replica/backend.md` (tableau « Ce que l'équipe doit fournir », ligne 1) cite déjà PawaPay, Flutterwave, CinetPay, MaxiCash et « intégrations directes » avec la mention « couverture RDC par opérateur non vérifiée » : c'est toujours vrai.

## 2. Critères pondérés (à ajuster par l'utilisateur ; total 100)

Note de 0 à 5 par candidat, puis note × poids. Un critère « éliminatoire » à 0 écarte le candidat quel que soit le total.

| # | Critère | Poids | Éliminatoire ? | Lien avec le code |
| --- | --- | --- | --- | --- |
| 1 | Couverture des 4 moyens : M-Pesa, Orange Money, Airtel Money, Africell Money | 15 | Oui si moins de 2 opérateurs majeurs | `PaymentMethod` (src/lib/types.ts:18) |
| 2 | **Encaissement ET paiement sortant** (retraits des vendeurs) | 15 | **Oui** | `initiateCollection`, `initiatePayout` (src/lib/payments/provider.ts:27-28) |
| 3 | Devises USD et CDF, en encaissement et en sortant | 10 | Selon décision commerciale | `Currency` (src/lib/types.ts:3) |
| 4 | Remboursement (total, idéalement partiel) vers le numéro payeur | 10 | **Oui** | `refund` (provider.ts:31) ; appelé sur annulation, litige, paiement tardif (pg/data.ts:1119, 1783) |
| 5 | Webhooks **signés** avec identifiant d'événement unique | 10 | **Oui** | route webhooks/psp/[provider]/route.ts:14 ; table `webhook_events`, unique (provider, event_id) |
| 6 | Idempotence des appels (clé fournie par nous) | 7 | Non, forte préférence | `idempotencyKey` (provider.ts:13, 24) |
| 7 | Bac à sable réaliste (succès, refus, délai) | 8 | Fortement souhaité | la recette (§7) en dépend |
| 8 | Interrogation d'état d'un encaissement | 5 | Non | `getCollection?` optionnelle (provider.ts:36) |
| 9 | Délai d'ouverture de compte et de vérification de l'entreprise (KYB) | 5 | Non | backend.md : « souvent la plus longue » |
| 10 | Conformité : licence du prestataire, compatibilité avec le séquestre | 5 | **Oui** | dépend de l'avis juridique (décision 3, partie b) |
| 11 | Frais, délais de règlement, plafonds | 5 | Non | frais actuels = PLACEHOLDERS (src/lib/fees.ts:24-36) |
| 12 | Documentation et support en français | 3 | Non | — |
| 13 | Réversibilité (changer de PSP plus tard) | 2 | Non | l'interface isole le métier |

## 3. Questionnaire à envoyer à chaque candidat

Mêmes questions pour tous ; réponses **par écrit**, avec une page de documentation par réponse.

**Couverture et produit**
1. Quels opérateurs RDC sont couverts aujourd'hui, séparément pour l'encaissement et pour le paiement sortant (M-Pesa, Orange Money, Airtel Money, Africell Money) ? Lesquels sont « annoncés » mais pas en production ?
2. Quelles devises par opérateur et par sens (USD, CDF) ? Y a-t-il une conversion, à votre charge ou à la nôtre ?
3. Montants minimum et maximum par transaction, par jour et par numéro, par opérateur.
4. Format exact des numéros acceptés et comportement si le numéro n'est pas inscrit chez l'opérateur.
5. Ce que voit le payeur (invite USSD, notification, code) et délai d'expiration de la demande.

**Argent**
6. Remboursement : total et partiel ? Délai ? Limite dans le temps après l'encaissement ? Retour sur le numéro payeur ? Frais retenus ?
7. Paiement sortant : vers n'importe quel numéro ? Vérification du nom du titulaire ? Que se passe-t-il si le numéro est faux ou bloqué ?
8. Frais détaillés (encaissement, sortant, remboursement, échec, abonnement). Qui paie en cas d'échec ?
9. Règlement : où et quand notre solde arrive-t-il ? Les fonds sont-ils détenus chez vous, dans quel cadre, avec quelle protection ?
10. Rapprochement : relevé quotidien exportable (identifiant, montant, devise, statut, date) ?

**Technique**
11. Webhooks : en-tête de signature, algorithme, contenu signé (corps brut ?), identifiant d'événement unique, horodatage anti-rejeu.
12. Politique de relance (nombre, intervalle, réponses attendues). L'ordre des événements est-il garanti ?
13. Idempotence : comment transmettre notre clé, durée de conservation, comportement en cas de rejeu avec des paramètres différents.
14. Interrogation d'état par référence : disponible ? limites de débit ?
15. Bac à sable : numéros de test pour succès, refus, solde insuffisant, délai ; peut-on déclencher un webhook à la demande ?
16. Liste complète des statuts et des codes d'échec.
17. Disponibilité (SLA publié), page d'état, historique d'incidents RDC.
18. Adresses IP d'émission des webhooks (liste blanche possible ?).

**Conformité et contrat**
19. Licence ou agrément du prestataire en RDC et auprès de quelle autorité (réponse écrite, à faire vérifier par le juriste).
20. Documents exigés pour le compte marchand et délai habituel. Une place de marché avec séquestre est-elle acceptée ?
21. Activités interdites ; le modèle « l'argent est gardé jusqu'à la remise » est-il autorisé chez vous ?
22. Durée de conservation des données de transaction, lieu d'hébergement, sous-traitants.
23. Résiliation : préavis, restitution des fonds, export des données.
24. Support : langues, horaires, canal, délai de réponse en cas d'incident.

## 4. Tableau comparatif à remplir (laisser vide si non répondu)

| Critère | PawaPay | CinetPay | MaxiCash | Flutterwave | Direct opérateurs | Autre : ____ |
| --- | --- | --- | --- | --- | --- | --- |
| M-Pesa (encaissement / sortant) | | | | | | |
| Orange Money (encaissement / sortant) | | | | | | |
| Airtel Money (encaissement / sortant) | | | | | | |
| Africell Money (encaissement / sortant) | | | | | | |
| USD / CDF | | | | | | |
| Remboursement (total / partiel) | | | | | | |
| Webhook signé (schéma) | | | | | | |
| Identifiant d'événement unique | | | | | | |
| Idempotence des appels | | | | | | |
| Interrogation d'état | | | | | | |
| Bac à sable (réalisme) | | | | | | |
| Frais encaissement / sortant | | | | | | |
| Plafonds | | | | | | |
| Délai de règlement | | | | | | |
| Délai d'ouverture (KYB) | | | | | | |
| Licence / conformité (réponse écrite) | | | | | | |
| Détention de fonds (qui, où) | | | | | | |
| **Total pondéré /500** | | | | | | |

## 5. Ce que le code attend : l'interface `PaymentProvider` existante

Fichier : src/lib/payments/provider.ts:26-37. Le métier ne connaît que ceci ; brancher un PSP = écrire une classe qui l'implémente et l'ajouter dans `createPaymentProvider` (src/lib/payments/index.ts), puis la faire passer par la suite de contrat.

**Méthodes**

| Méthode | Entrée | Sortie | Appelée depuis | Remarque |
| --- | --- | --- | --- | --- |
| `name` (lecture seule) | — | chaîne | partout | stockée dans `payments.provider`, `payouts.provider`, `webhook_events.provider` ; **ne pas la changer après le lancement sans plan de migration** |
| `initiateCollection(req)` | `orderId, paymentId, amountMinor, currency, method, msisdn, idempotencyKey` (provider.ts:7-15) | `{ providerRef }` | pg/data.ts:932, **hors transaction** | l'abonné valide sur son téléphone ; résultat final par webhook. Exception → paiement `failed` (PROVIDER_ERROR), HTTP 502 « PSP_UNAVAILABLE » (data.ts:935-938) |
| `initiatePayout(req)` | `payoutId, amountMinor, currency, method, msisdn, idempotencyKey` (provider.ts:17-24) | `{ providerRef }` | data.ts:1579 | résultat final par webhook `payout.*` |
| `refund({providerRef, amountMinor})` | référence de l'**encaissement** et montant | `{ ok }` | `refundAtProvider` (data.ts:1783) | **pas de devise ni de motif dans la signature**. Une exception est seulement journalisée dans `audit_log` (`refund_failed`) : **aucune relance automatique** (backend.md, risque 4) ; la valeur `ok` retournée n'est pas lue |
| `getCollection?(providerRef)` (optionnelle) | référence | `pending \| succeeded \| failed` + `failureCode?` | rapprochement (data.ts:664-665) | sans elle, seul le rapprochement quotidien rattrape un webhook perdu |

**Unités** : montants en **unités mineures entières** (cents USD, centimes de franc). L'adaptateur convertit si le PSP travaille autrement.

**Événements entrants** (schéma zod src/lib/schemas.ts:96-101)

| Champ | Règle |
| --- | --- |
| `eventId` | texte 1-200 ; **unique par fournisseur** (contrainte unique (provider, event_id), db/migrations/0001_core.sql, table `webhook_events`) |
| `type` | `collection.succeeded`, `collection.failed`, `payout.succeeded`, `payout.failed` |
| `providerRef` | référence rendue par `initiateCollection` / `initiatePayout` |
| `failureCode` | optionnel, 100 caractères max ; défaut `DECLINED` (collecte) et `FAILED` (sortant) (data.ts:1109, 1134) |

L'adaptateur doit **traduire** le message natif du PSP vers ce format. Le schéma n'a ni montant, ni devise, ni horodatage.

**Signature des webhooks aujourd'hui** : `POST /api/v1/webhooks/psp/[provider]` (route.ts). Elle n'accepte que `provider === "fake"` (route.ts:12), lit le corps **brut**, vérifie l'en-tête `x-signature` = HMAC-SHA256 hexadécimal du corps avec `PSP_WEBHOOK_SECRET`, en comparaison à temps constant (provider.ts:41-50), puis valide avec zod. Elle répond 409 si la référence est inconnue, pour que le PSP rejoue (route.ts:24). **Un vrai PSP a son propre schéma de signature** : il faut une vérification propre à chaque fournisseur (en-tête, algorithme, contenu signé, horodatage éventuel), à écrire avec l'adaptateur, et élargir la liste blanche de la ligne 12.

**Traitement** (pg/data.ts:1086-1143) : référence inconnue → événement non enregistré, 409 (l.1090-1094) ; événement déjà vu → `duplicate` (l.1100) ; encaissement déjà `succeeded`/`refunded` → aucun effet (l.1106) ; succès sur commande non expirée → commande payée, séquestre écrit, vendeur notifié ; succès **après** expiration ou annulation → remboursement automatique (l.1119) ; payout déjà `paid`/`failed` → aucun effet (l.1128).

**Ce que fait le faux fournisseur** (src/lib/payments/fake-provider.ts) : aucun appel réseau ; numéro finissant par « 00 » = refus `INSUFFICIENT_FUNDS`, tout autre = succès (l.38-39) ; `refund` enregistre dans une liste et rend `ok: true` ; `getCollection` répond tout de suite ; **le webhook est déclenché par le code lui-même** après un délai (`providerDelayMs: 3000`, src/lib/data/index.ts:20) via `provider instanceof FakeMobileMoneyProvider` (pg/data.ts:941-944). Un vrai adaptateur n'y passe pas. Interdit en production (config.ts:23-24).

**Écarts entre le faux fournisseur et la réalité** (à traiter dans l'adaptateur ou le code) :
1. L'événement ne porte **pas le montant** : le code ne vérifie jamais que le PSP a encaissé la somme attendue. À ajouter (montant, devise) avant la production.
2. Remboursement partiel : l'interface le permet, le métier ne le demande pas aujourd'hui (montant = totalité).
3. Un échec de remboursement n'est pas relancé.
4. Ordre des événements non garanti : un webhook peut arriver avant l'écriture de `provider_ref` (géré par 409 + rejeu, à tester contre le PSP).
5. Délais : un encaissement sans référence au bout de 120 s passe en `PROVIDER_TIMEOUT` (data.ts:658-662) ; la commande non payée expire à 15 minutes (fees.ts:30, PLACEHOLDER). **Le délai de validation du PSP doit être plus court que 15 min**, sinon les paiements tardifs (donc remboursements) seront fréquents.
6. Les frais du PSP (compte `psp_fees`) ne sont jamais soldés (backend.md, risque 3).

## 6. Variables d'environnement à ajouter ou modifier

| Variable | Rôle | Garde-fou actuel |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | nom du fournisseur choisi (= `name` de la classe) | `fake` refusé en production sauf `ALLOW_FAKE_PAYMENTS=1` (config.ts:23-24) ; tout autre nom exige `PSP_WEBHOOK_SECRET` (config.ts:25) |
| `PSP_WEBHOOK_SECRET` | secret de signature des webhooks (24 caractères minimum) | config.ts:13-16, 25 |
| Clés propres au PSP (noms à fixer avec l'adaptateur : clé d'API, identifiant marchand, URL de base, URL publique de rappel) | appels sortants | **à ajouter** à `.env.example` (ligne 28 le prévoit) **et à `productionProblems`** (config.ts:10-29), sinon le serveur démarre sans elles |
| Indicateur bac à sable / réel | éviter de pointer la production sur le bac à sable | à créer ; refuser « bac à sable » en production |

Aucun secret n'est écrit dans le dépôt : l'utilisateur les crée chez le prestataire et les place dans l'hébergeur.

## 7. Tests de recette avant la mise en production

D'abord contre le bac à sable, puis contre le compte réel avec des montants minimes. Pour chaque cas, vérifier en base (`payments`, `orders`, `ledger_entries`, `webhook_events`) et avec les requêtes de surveillance de backend.md.

| # | Cas | Étapes | Résultat attendu |
| --- | --- | --- | --- |
| R1 | **Succès**, chaque opérateur × chaque devise proposée | commande → paiement → valider | commande « payée », séquestre = total, vendeur notifié, un seul `webhook_events` traité |
| R2 | **Refus** (solde insuffisant) | numéro de test « refus » | paiement `failed` avec code, commande toujours payable, aucune écriture au grand livre |
| R3 | Abonné qui ne valide pas | laisser expirer | rapprochement → `failed` ; commande expirée à 15 min ; articles libérés |
| R4 | **Paiement tardif** | valider **après** expiration de la commande | remboursement automatique (data.ts:1119) ; `payments.status = refunded` ; appel `refund` réussi chez le PSP (sinon ligne `refund_failed`) |
| R5 | **Remboursement** sur annulation ou litige | payer, annuler (ou litige gagné par l'acheteur) | argent rendu au payeur, grand livre équilibré (requête 1 de backend.md vide) |
| R6 | Remboursement refusé par le PSP | simuler une erreur | ligne `refund_failed` dans `audit_log` ; procédure manuelle écrite |
| R7 | **Webhook rejoué** (même `eventId`, 2 à 5 fois) | rejouer depuis le tableau de bord du PSP | `duplicate: true`, aucun second effet |
| R8 | **Webhook hors ordre** | `failed` après `succeeded` ; événement arrivé avant `provider_ref` | succès non écrasé ; événement précoce → 409 puis accepté au rejeu |
| R9 | Signature invalide, absente, corps modifié, rejeu ancien | requêtes forgées | 401, aucun effet, aucune donnée personnelle dans les journaux |
| R10 | Même clé d'idempotence rejouée | deux POST de paiement identiques | un seul encaissement chez le PSP |
| R11 | Webhooks perdus | bloquer les webhooks | `reconcile_pending_payments` rattrape (via `getCollection` ou relevé) |
| R12 | Montant ou devise inattendus (après ajout de la vérification) | événement incohérent | rejet et alerte |
| R13 | Paiement sortant : succès, échec (numéro bloqué), doublon | retrait de test | solde vendeur correct dans les 3 cas, `payout_pending` soldé |
| R14 | PSP indisponible | couper le réseau sortant | 502 « PSP_UNAVAILABLE », paiement `failed`, aucun argent bloqué |
| R15 | Rapprochement | comparer `psp_clearing` (requête 5 de backend.md) au relevé du PSP | écart nul ou expliqué par les frais |
| R16 | Lenteur | 60 à 120 s entre demande et validation | pas de double paiement, interface cohérente |

## 8. Ordre des étapes

1. Décider des critères éliminatoires (vous) ; envoyer le questionnaire à 2 ou 3 candidats (vous).
2. Lancer **en parallèle** l'avis juridique (décision 3, partie b) : il peut changer le modèle de détention de fonds.
3. Ouvrir un compte **bac à sable** chez le candidat retenu (vous). Les valeurs restent chez l'hébergeur ; Claude n'a besoin que des noms de variables.
4. Lancer le dossier KYB dès le choix : c'est le chemin critique (semaines, délai à demander).
5. Claude écrit l'adaptateur, la vérification de signature propre au PSP, la vérification du montant et la relance des remboursements ; tests de contrat contre le bac à sable.
6. Passer R1 à R16 sur le bac à sable.
7. Compte réel : R1, R4, R5, R13 avec montants minimes ; rapprochement R15.
8. Renseigner `PAYMENT_PROVIDER`, `PSP_WEBHOOK_SECRET` et les clés ; vérifier que `productionProblems` ne remonte plus rien (décision 4).
9. Pilote limité (décision 4, §10).
