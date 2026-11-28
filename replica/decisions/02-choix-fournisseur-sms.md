# Décision 2 : choix du fournisseur SMS

Statut : **à décider par l'utilisateur**. Rédigé le 2026-11-28. Aucun compte créé, aucune API de prestataire appelée, aucun secret écrit. Citations « fichier:ligne » au commit `10a8aeb`.

## 1. Ce que le code envoie, et comment

Interface : `SmsProvider { name; send(toE164, text): Promise<void> }` (src/lib/sms/provider.ts:9-12). Seul `console` existe (provider.ts:15-24) ; tout autre nom lève une erreur (provider.ts:26-30). En production, `SMS_PROVIDER=console` est refusé (src/lib/config.ts:26).

Il n'y a **que deux usages** :
1. **Code de connexion** (pg/data.ts:492) : bloquant. Si l'envoi échoue, le code est supprimé et l'utilisateur reçoit 502 « SMS_UNAVAILABLE » (data.ts:495-497).
2. **SMS de notification** (3 événements critiques) : hors transaction, jamais bloquant, erreur seulement journalisée (data.ts:441-466, `fireSms`).

Conséquence pour le choix : **la connexion dépend à 100 % du SMS** (identité = téléphone, pas d'autre moyen). Une panne SMS = personne ne se connecte. Le repli (WhatsApp, appel vocal) n'est pas codé (backend.md, ligne 3 du tableau « Ce que l'équipe doit fournir »).

## 2. Faits trouvés sur le web (pages officielles, consultées le 2026-11-28)

| Fait | Source | Limite |
| --- | --- | --- |
| Twilio, RDC : l'expéditeur alphanumérique dynamique est pris en charge, sans préinscription listée. « Numeric Sender IDs are not supported by Airtel network » : un SMS avec expéditeur numérique n'est **pas délivré** aux abonnés Airtel ; Twilio recommande l'alphanumérique. Éviter les expéditeurs génériques (« InfoSMS », « INFO », « Verify », « Notify »). Pas de SMS vers lignes fixes. SMS bidirectionnel non pris en charge. | https://www.twilio.com/en-us/guidelines/cd/sms | Règles **de Twilio** ; ne vaut pas pour un autre fournisseur. |
| Link Mobility, RDC (mise à jour affichée « 4/30/2026 ») : Airtel Congo DR n'accepte que l'alphanumérique ; Africell, Millicom, Orange, Vodacom acceptent alphanumérique et numérique. « There is no requirement or possibility for registration for this destination. » | https://docs.linkmobility.com/regulatory-guidelines/sender-id/democratic-republic-of-congo | Règles d'**un agrégateur** ; le juriste doit confirmer l'absence d'obligation d'enregistrement du côté du régulateur local (non sourcé ici). |
| Un autre fournisseur (D7 Networks) affirme qu'un expéditeur local doit être enregistré. | https://d7networks.com/sms/congo/ (extrait de recherche, page non ouverte) | **Contradiction avec la ligne précédente** : à clarifier par écrit avec chaque candidat. |
| Orange propose une API SMS « SMS DR Congo » ; extrait de recherche : « limited to a 25 200u purchase per day per SIM card ». | https://developer.orange.com/apis/sms-cd (page non ouverte) | Sens exact de la limite inconnu : à demander à Orange. |

Prestataires dont la RDC apparaît dans les résultats (noms seulement, rien d'évalué) : Twilio, Telnyx, Plivo, AWS End User Messaging, Orange Developer. Africa's Talking et Infobip : rien trouvé dans cette recherche, à interroger quand même.

## 3. Critères pondérés (total 100)

| # | Critère | Poids | Éliminatoire ? | Remarque |
| --- | --- | --- | --- | --- |
| 1 | **Délivrabilité réelle** sur Vodacom, Orange, Airtel, Africell (taux et délai, mesurés par vous) | 25 | Oui | la connexion en dépend |
| 2 | Expéditeur : alphanumérique accepté sur les 4 opérateurs, sans exigence d'enregistrement bloquante | 15 | Oui pour Airtel | numérique non livré sur Airtel selon Twilio et Link Mobility |
| 3 | Rapports de livraison (statut par message) | 8 | Non | utile pour mesurer 1 |
| 4 | Coût par SMS, par opérateur, et frais fixes | 10 | Non | « à demander » |
| 5 | Plafonds, limites de débit, protection contre le « SMS pumping » (blocage par pays, par préfixe, alertes de dépense) | 12 | Non, fortement souhaité | risque n° 1 de backend.md |
| 6 | Option de repli (WhatsApp, voix) chez le même prestataire | 8 | Non | la connexion n'a aucun repli aujourd'hui |
| 7 | Contrat et facturation : prépayé, plafond de dépense, devises, moyen de paiement possible depuis la RDC | 7 | Non | |
| 8 | Qualité de l'API (authentification, idempotence, erreurs claires, bac à sable) | 5 | Non | |
| 9 | Conformité : données personnelles (numéros), lieu de traitement | 5 | À valider | décision 3, partie d |
| 10 | Support en français / délai d'ouverture | 5 | Non | |

## 4. Questionnaire pour chaque candidat

1. Les 4 opérateurs RDC sont-ils livrés en direct, ou via un intermédiaire ? Lesquels passent par des routes « grises » ? Preuve écrite.
2. Expéditeur alphanumérique : accepté sur chaque opérateur ? Enregistrement obligatoire (qui, quels documents, quel délai) ? Que devient le nom d'expéditeur sur Airtel ?
3. Expéditeur numérique ou numéro dédié : livré sur Airtel ? Coût mensuel ?
4. Taux de livraison et délai médian mesurés en RDC sur les 3 derniers mois, par opérateur (chiffres écrits).
5. Prix par SMS par opérateur et par palier ; frais d'échec ; facturation des SMS non délivrés.
6. Rapports de livraison : format, délai, webhook ?
7. Protection contre la fraude de volume : listes de pays/préfixes bloqués, plafond quotidien côté fournisseur, alerte de dépense, coupure automatique.
8. Limite de débit de l'API ; file d'attente ; comportement en cas de rafale (connexions simultanées).
9. Longueur maximale, jeu de caractères (accents français et GSM-7 / UCS-2 : coût d'un caractère hors GSM), segmentation.
10. Repli : WhatsApp Business, appel vocal avec code ? Même API ?
11. Contrat : prépaiement, seuil minimum, devises acceptées, factures, résiliation, restitution du solde.
12. Données : conservation du contenu des messages et des numéros, lieu de stockage, sous-traitants, possibilité de masquer le contenu.
13. Bac à sable ou numéros de test ; délai d'ouverture de compte.
14. Historique d'incidents sur la RDC, page d'état, support (langue, horaires).

## 5. Tableau comparatif à remplir

| Critère | Twilio | Telnyx | Plivo | AWS End User Messaging | Orange (API directe) | Africa's Talking | Infobip | Autre : ____ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vodacom : livraison / délai | | | | | | | | |
| Orange : livraison / délai | | | | | | | | |
| Airtel : livraison / délai | | | | | | | | |
| Africell : livraison / délai | | | | | | | | |
| Expéditeur alphanumérique (enregistrement) | | | | | | | | |
| Coût par SMS | | | | | | | | |
| Rapport de livraison | | | | | | | | |
| Protection contre la fraude de volume | | | | | | | | |
| Plafond de dépense | | | | | | | | |
| Repli WhatsApp / voix | | | | | | | | |
| Délai d'ouverture | | | | | | | | |
| **Total pondéré /500** | | | | | | | | |

**Test de délivrabilité à faire soi-même avant de choisir** (reste à l'utilisateur) : avec le compte d'essai de 2 candidats, envoyer 20 messages par opérateur vers des SIM réelles, à des heures différentes, noter reçu / non reçu et délai ; garder les captures.

## 6. Textes de SMS actuels, pour relecture

`APP_NAME` vaut « NomAppli » : **PLACEHOLDER** (src/lib/copy.ts:4). Le nom définitif changera tous les textes et leur longueur.

| # | Usage | Texte exact | Source | Données sensibles ? |
| --- | --- | --- | --- | --- |
| 1 | Code de connexion | `NomAppli : ton code est ###### . Il expire dans 5 minutes. Ne le partage avec personne.` (code à 6 chiffres) | src/lib/data/pg/data.ts:492 | le code seul ; expire en 5 min (data.ts:487-488) |
| 2 | Vendeur : commande payée | `NomAppli : une de tes annonces vient d'être payée. Ouvre l'application pour organiser la remise.` | src/lib/notifications.ts:92 | aucune (ni montant, ni titre, ni nom) |
| 3 | Litige ouvert | `NomAppli : un litige a été ouvert sur une de tes commandes. Ouvre l'application pour répondre.` | notifications.ts:93 | aucune |
| 4 | Litige résolu | `NomAppli : un litige sur une de tes commandes est résolu. Ouvre l'application pour voir la décision.` | notifications.ts:94 | aucune |

À relire (langue, ton, tutoiement, clarté pour une personne peu à l'aise avec l'écrit) ; **à faire valider** si le juriste exige une mention d'identification de l'expéditeur ou une possibilité de désinscription (question, pas une règle connue). Longueur et jeu de caractères (à confirmer avec le fournisseur choisi) : en alphabet GSM standard, un segment fait 160 caractères ; dès qu'un caractère hors de cet alphabet apparaît, le message passe en UCS-2 (70 caractères par segment) et peut coûter plusieurs segments. Les lettres é, è, à sont dans l'alphabet GSM standard, mais pas ê, ô, î : le texte n° 2 contient « être » (ê) et environ 100 caractères, donc probablement 2 segments ; les textes 1, 3 et 4 restent a priori en un segment si « NomAppli » ne change pas la donne. Un nom d'application avec accent ou une apostrophe typographique changerait cela. **À tester avec le fournisseur** et à reformuler (ex. « payée » sans « être ») si le coût compte.

Les autres notifications (message reçu, commande terminée, etc.) restent **internes** (pas de SMS) : `SMS_KIND_CATEGORY` ne contient que `order_paid`, `dispute_opened`, `dispute_resolved` (notifications.ts:80-84).

Préférences : SMS « commandes » et « litiges » activés par défaut, désactivables par le membre (notifications.ts:72-77). Le code de connexion n'est pas désactivable.

## 7. Politique de plafond actuelle, et ce qui manque

| Protection | Valeur actuelle | Source |
| --- | --- | --- |
| Codes de connexion par numéro | 3 par 10 minutes | pg/data.ts:482 |
| Codes de connexion par adresse IP | 20 par 10 minutes | src/app/api/v1/auth/otp/route.ts:8 |
| Essais de vérification | 5 par code ; 30 vérifications par IP et 10 min | data.ts:509 ; auth/otp/verify/route.ts:10 |
| SMS de notification | **5 par numéro et par jour** | notifications.ts:87 ; data.ts:454 |
| Durée de vie du code | 5 minutes | data.ts:487-488 |
| Format du numéro | normalisation RDC avant envoi (numéros invalides refusés en 422) | data.ts:480-481 |

**Ce qui manque** (backend.md, risque n° 1 « SMS pumping ») :
1. **Plafond global quotidien** de SMS (tous numéros confondus), avec coupure ou mode dégradé au-delà : inexistant.
2. **Alerte de dépense** (seuil, e-mail ou message à l'exploitation) : inexistante ; à régler d'abord **chez le fournisseur** (plafond de compte), puis dans l'application (compteur global).
3. **Plafond par préfixe/opérateur** et détection d'un afflux anormal vers un même préfixe : inexistant.
4. Les limites par IP dépendent d'un proxy de confiance qui écrase `x-forwarded-for` (src/lib/ratelimit.ts:6-10) : à vérifier chez l'hébergeur.
5. Journal de coût : aucun compteur d'envois par jour n'est exposé à l'exploitation.
6. **Repli** si le SMS ne part pas : aucun (WhatsApp, voix).
7. Une vérification (CAPTCHA, preuve de travail) avant l'envoi du code n'existe pas.

Ces points relèvent de code que Claude peut écrire (compteur global dans `rate_limits`, alerte), mais le **seuil** (en nombre de SMS et en dollars) est une décision de l'utilisateur.

## 8. Variables d'environnement à ajouter

| Variable | Rôle | Note |
| --- | --- | --- |
| `SMS_PROVIDER` | nom du fournisseur (déjà prévue, .env.example:32) | `console` refusé en production (config.ts:26) |
| Clés propres au fournisseur (identifiant de compte, jeton, expéditeur, éventuellement URL de rapport de livraison) | appels sortants | noms à fixer avec l'adaptateur ; à ajouter à `.env.example` **et** à `productionProblems` |
| `SMS_SENDER_ID` (nom proposé) | expéditeur alphanumérique | à ajouter ; 11 caractères max est la règle courante des expéditeurs alphanumériques (à confirmer par fournisseur) |
| `SMS_GLOBAL_DAILY_LIMIT` (nom proposé) | plafond global | à créer avec le code du plafond |

## 9. Recette avant la mise en production

| # | Cas | Attendu |
| --- | --- | --- |
| S1 | Code de connexion reçu sur chaque opérateur (au moins 10 essais par opérateur) | reçu en moins de 30 s dans au moins 90 % des cas (seuil à fixer par vous) |
| S2 | Expéditeur affiché correctement sur Airtel, Orange, Vodacom, Africell | lisible, pas de numéro étranger bizarre |
| S3 | Accents et longueur | texte intact, nombre de segments connu |
| S4 | Échec d'envoi (fournisseur coupé) | l'utilisateur voit « SMS_UNAVAILABLE », aucun code orphelin |
| S5 | 4 ou 6 demandes de code d'affilée | la 4e est refusée (429) |
| S6 | SMS de notification : 6e SMS du jour au même numéro | non envoyé (plafond 5) |
| S7 | Plafond global et alerte de dépense (une fois codés) | coupure déclenchée à une valeur de test basse |
| S8 | Numéro changé de propriétaire / SIM inactive | pas de blocage durable du compte légitime (procédure d'assistance écrite) |

## 10. Ordre des étapes

1. Vous : choisir 2 candidats, poser le questionnaire, faire le test de délivrabilité.
2. Vous : créer le compte et **fixer un plafond de dépense chez le fournisseur** avant toute clé en production.
3. Vous : demander au juriste si un enregistrement d'expéditeur ou une mention est requis (décision 3).
4. Claude : adaptateur `SmsProvider`, plafond global, alerte, tests de contrat ; relecture des 4 textes avec vous.
5. Recette S1 à S8, puis `SMS_PROVIDER` en production (décision 4).
