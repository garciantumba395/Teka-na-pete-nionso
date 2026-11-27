# Plan de test : marketplace RDC (reconstruction de Vinted, jalon M0)

Build : voir `git log`. Date : 2026-11-27. Environnement : local, serveur de développement, données de démonstration.
Deux exécutions : **couche factice** (`npm run test:e2e`) et **PostgreSQL** (`npm run test:e2e:pg`). Paiement et SMS factices dans les deux.

**Règle** : on teste *notre* clone. Aucune requête n'est envoyée au service d'origine.

## Légende

- **type** : H = chemin nominal, E = cas limite, N = cas négatif, G = « écart connu » (fonction non construite, on vérifie seulement que l'écran répond proprement).
- **auto** : `e2e` = automatisé (Playwright, `e2e/specs/`), `manuel` = à faire à la main (voir fin du document), `—` = sans objet.
- **résultat** : rempli par `node scripts/plan-results.mjs` depuis le dernier rapport. Une case vide = jamais exécutée.
- Les fonctions **non construites** (F03 à F08, sauf routes) ne sont **pas comptées comme réussies** : voir « Couverture ».

## Flux de la carte de reconnaissance

| flux | écrans | état de construction |
| --- | --- | --- |
| F01 Vendre un article | S05, S04 | construit (partiel : pas de brouillon, pas d'édition) |
| F02 Acheter (Buy now) | S04, S08, S09 | construit (remise en main propre seulement) |
| F03 Litige et remboursement | S09, S11 | **non construit** (écran en attente) ; remboursement par annulation construit |
| F04 Acheter un lot | S06 | **non construit** (aucune interface) |
| F05 Négocier / poser une question | S07 | **non construit** |
| F06 Laisser un avis | S13, S14 | **non construit** |
| F07 Devenir vendeur Pro | S18 | **non construit** |
| F08 Modération | S19 | **non construit** |
| Transversaux : connexion (A), recherche (R), portefeuille (W), sécurité (SEC), accessibilité (X), réseau (N) | S02, S03, S14–S16 | construits |

## F01 : Vendre un article

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| F01-H1 | H | /sell, 2 photos, titre, description, catégorie, état, prix 25, Publier | fiche affichée, annonce visible sur l'accueil pour un autre membre | e2e |
| F01-E1 | E | Publier avec le formulaire vide | message global, une erreur par champ requis, focus sur le premier champ en erreur, rien créé | e2e |
| F01-E2 | E | double-clic sur Publier | une seule annonce créée | e2e |
| F01-E3 | E | titre de 81 caractères (interface puis API) | interface : limité à 80 ; API : refus 422 | e2e |
| F01-E4 | E | titre avec emoji, accents, `%`, `<b>`, guillemets | affiché tel quel (pas de HTML interprété), retrouvé par la recherche | e2e |
| F01-E5 | E | prix : « 12,5 », « 1 250 », « 0 », « -5 », « abc », « 1000,01 », CDF « 35 000 », CDF « 35 000,5 » | valides acceptés avec le bon affichage ; invalides refusés avec un message | e2e |
| F01-E6 | E | 21 photos ; un fichier texte ; une image 4000×3000 | 20 maximum + message ; message clair ; image compressée sous le seuil | e2e |
| F01-E7 | E | session expirée pendant la saisie, puis Publier | retour à la connexion avec retour prévu vers /sell | e2e |
| F01-E8 | E | octet nul et caractères de contrôle dans titre, description, marque (API) | refus propre (4xx) ou accepté nettoyé, **jamais 5xx** | e2e |
| F01-E9 | E | charges XSS dans titre, description, marque | aucune boîte de dialogue, aucun élément injecté | e2e |
| F01-E10 | E | largeur 320 px sur /sell et sur la fiche | pas de défilement horizontal | e2e |
| F01-E11 | E | tout remplir et publier au clavier seul | annonce publiée | e2e |
| F01-N1 | N | /sell sans être connecté | vrai 307 vers /signin?next=/sell | e2e |
| F01-N2 | N | publier dans une catégorie non vendable (API) | 422 | e2e |
| F01-N3 | N | un second membre lit, publie, ou modifie le brouillon d'un autre | 404, rien ne change | e2e |

## F02 : Acheter un article

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| F02-H1 | H | fiche → Acheter → Payer → code → le vendeur saisit le code | vente terminée, acheteur voit « Article reçu », portefeuille du vendeur crédité du prix | e2e |
| F02-E1 | E | double-clic sur Acheter | une seule commande | e2e |
| F02-E2 | E | double-clic sur Payer | un seul paiement, commande payée | e2e |
| F02-E3 | E | rafraîchir la page pendant l'attente du paiement | l'attente reprend, puis commande payée | e2e |
| F02-E4 | E | Retour puis Avancer du navigateur depuis la page de paiement | pas de plantage, état cohérent | e2e |
| F02-E5 | E | deux acheteurs ouvrent la même annonce, l'un achète | l'autre reçoit un message clair, puis voit « Réservé » | e2e |
| F02-E6 | E | numéro refusé puis numéro accepté | « Paiement refusé », puis commande payée | e2e |
| F02-E7 | E | horloge du téléphone en avance de 2 h, puis en retard de 2 h | le compte à rebours reste cohérent, on ne quitte pas la page de paiement | e2e |
| F02-E8 | E | perdre le réseau au moment de Payer, puis le retrouver | message clair, bouton de nouveau actif, paiement possible ensuite | e2e |
| F02-E9 | E | session expirée sur la page de paiement, puis Payer | retour à la connexion, pas de blocage | e2e |
| F02-E10 | E | l'acheteur annule avant de payer | commande annulée, article de nouveau achetable | e2e |
| F02-E11 | E | le vendeur annule après paiement | acheteur remboursé, article remis en vente | e2e |
| F02-E12 | E | l'acheteur annule après paiement, avant la remise | remboursement intégral, article remis en vente | e2e |
| F02-E13 | E | 5 mauvais codes de remise | verrouillage, même le bon code refusé, l'acheteur peut encore annuler | e2e |
| F02-E14 | E | le vendeur cherche à lire le code de remise | refusé (404), le code n'apparaît pas sur sa page | e2e |
| F02-E15 | E | le vendeur achète sa propre annonce | pas de bouton ; l'API refuse (409) | e2e |
| F02-E16 | E | acheter un article déjà vendu | pas de bouton, l'API refuse (409) | e2e |
| F02-E17 | E | totaux : 25 $, 100 $, 1 $, 35 000 FC | total = prix + protection (5 %, minimum), calculé par le serveur | e2e |
| F02-N1 | N | un tiers ouvre la commande (page et API) | 404 | e2e |
| F02-N2 | N | le vendeur ouvre /orders/…/pay | redirigé vers la commande | e2e |
| F02-N3 | N | numéro de paiement invalide | message clair, rien débité | e2e |

## F03 à F08 : flux non construits (écart connu)

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| F03-G1 | G | « J'ai un problème » sur une commande payée | arrive sur un écran qui dit honnêtement « Bientôt disponible » | e2e |
| F03-G2 | G | /orders/…/dispute directement | 200 et message, pas de 404 ni de 5xx | e2e |
| F04-G1 | G | acheter plusieurs articles du même vendeur | **aucune interface** (le serveur sait le faire) | — |
| F05-G1 | G | /inbox | écran « Bientôt disponible » | e2e |
| F06-G1 | G | /orders/…/review | écran « Bientôt disponible » | e2e |
| F07-G1 | G | /pro | écran « Bientôt disponible » | e2e |
| F08-G1 | G | /report | écran « Bientôt disponible » | e2e |
| F08-G2 | G | modération, sanctions, annonce masquée | **non construit** | — |

## A : connexion et compte

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| A-H1 | H | numéro, Entrée, code, nom, Entrée (clavier seul) | compte créé, connecté | e2e |
| A-E1 | E | formats : « +243 81 000 0001 », « 0810000001 », « 810000001 », avec tirets et parenthèses ; invalides : lettres, trop court, « 07… », « +33… » | valides normalisés au même numéro ; invalides refusés (422) | e2e |
| A-E2 | E | 5 mauvais codes, puis le bon | verrouillé ; un nouveau code débloque | e2e |
| A-E3 | E | coller « 123456 » dans la première case | les 6 cases se remplissent | e2e |
| A-E4 | E | taper des lettres dans les cases du code | ignorées | e2e |
| A-E5 | E | demander 4 codes pour le même numéro | 4e refusé (429), compte à rebours de renvoi affiché | e2e |
| A-E6 | E | 25 demandes depuis la même adresse | 429 avec Retry-After | e2e |
| A-E7 | E | `?next=` malveillant : `//evil.com`, `https://evil.com`, `/\evil.com`, `javascript:alert(1)` | on reste sur notre site, jamais de redirection externe | e2e |
| A-E8 | E | pages protégées sans session | vrai 307 vers /signin?next=… | e2e |
| A-E9 | E | se déconnecter puis bouton Retour | aucune donnée privée visible, session invalide côté serveur | e2e |
| A-E10 | E | « se déconnecter partout » | la session d'un second appareil est révoquée | e2e |
| A-E11 | E | supprimer le compte avec une commande ouverte, puis sans | refusé, puis accepté ; ancien cookie sans effet ; numéro libéré | e2e |
| A-E12 | E | cookie de session | HttpOnly, SameSite=Lax, jeton opaque | e2e |
| A-E13 | E | nom : emoji, 1 caractère, 41 caractères, espaces, balise HTML | emoji accepté ; invalides refusés ; HTML jamais interprété | e2e |
| A-N1 | N | nouveau code demandé pour un numéro jamais vu, code faux | message identique (pas d'énumération des comptes) | e2e |

## R : recherche

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| R-H1 | H | mot-clé, catégorie, prix max, rayon, combinés ; effacer un filtre | résultats cohérents, puces de filtres actives | e2e |
| R-E1 | E | mot-clé de 10 000 caractères, emoji, accents | pas d'erreur, résultat vide ou borné | e2e |
| R-E2 | E | prix max : « abc », négatif, énorme | ignoré ou borné, pas d'erreur | e2e |
| R-E3 | E | zone ou catégorie invalide dans l'URL | pas de 5xx | e2e |
| R-E4 | E | recherche par rayon | trié par distance croissante | e2e |

## W : portefeuille et retrait

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| W-H1 | H | après une vente : solde, retrait de 10 $, historique | solde = prix − retrait − frais ; statut « Reçu » | e2e |
| W-E1 | E | double-clic sur Retirer | un seul retrait | e2e |
| W-E2 | E | retrait vers un numéro refusé | statut « Échoué », solde recrédité en totalité | e2e |
| W-E3 | E | sous le minimum ; supérieur au solde ; « 1,234 » ; CDF avec décimales | refusés avec un message clair | e2e |
| W-E4 | E | deux retraits simultanés de la moitié du solde + 1 | un seul passe | e2e |
| W-E5 | E | retrait avec session expirée | retour à la connexion | e2e |
| W-N1 | N | portefeuille et retraits d'un autre membre | invisibles | e2e |

## SEC : sécurité

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| SEC-1 | N | un tiers appelle toutes les routes /orders/{id}/* | 404 partout, commande intacte | e2e |
| SEC-2 | N | identifiants invalides (`x`, `1; drop table`, uuid inexistant) sur toutes les routes à identifiant | 404, jamais 5xx | e2e |
| SEC-3 | N | octet nul et caractères de contrôle dans recherche et champs | jamais 5xx | e2e |
| SEC-4 | N | méta-caractères de recherche : `'`, `%`, `_`, `\`, `"; drop table--` | 200 ; « 100% » ne correspond pas à tout | e2e |
| SEC-5 | N | XSS stockée : titre, description, marque, nom, bio | aucun dialogue, rien d'injecté | e2e |
| SEC-6 | N | webhook : sans signature, signature fausse, corps modifié, événement inconnu | 401, 401, 401, 409 | e2e |
| SEC-7 | N | tâches planifiées : sans secret, mauvais secret, bon secret | 401, 401, 200 | e2e |
| SEC-8 | E | en-têtes de sécurité sur les pages | nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy | e2e |
| SEC-9 | N | JSON invalide, corps énorme, mauvais type de contenu | 400/413/422, jamais 5xx | e2e |
| SEC-10 | N | 12 commandes en 10 minutes par le même membre | 429 au-delà de 10 | e2e |
| SEC-11 | N | le client impose `totalMinor`, `status`, `role` dans les corps | ignorés par le serveur | e2e |
| SEC-12 | N | photos : mauvais identifiant, en-têtes | 404 ; nosniff + CSP sandbox + cache immuable | e2e |

## X : accessibilité

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| X-1 | E | analyse axe (WCAG 2.1 A et AA + bonnes pratiques) sur chaque écran, mobile et bureau | aucune violation grave ou critique | e2e |
| X-2 | E | clavier seul : lien d'évitement, ordre de tabulation, focus visible | atteignable et visible | e2e |
| X-3 | E | 320 px, texte agrandi | pas de défilement horizontal, rien de coupé | e2e |
| X-4 | E | `prefers-reduced-motion` | animations coupées | e2e |
| X-5 | E | lecteur d'écran réel (NVDA, TalkBack, VoiceOver) | annonces et libellés corrects | **manuel** |

## N : réseau

| cas | type | étapes | attendu | auto |
| --- | --- | --- | --- | --- |
| N-1 | E | latence ajoutée de 3 s sur les appels d'API pendant Acheter et Payer | boutons inactifs pendant l'attente, aucun double envoi | e2e |
| N-2 | E | hors ligne puis retour en ligne sur la fiche et la vente | message clair, reprise possible | e2e |
| N-3 | E | téléphone bas de gamme, 3G lente, vrai appareil | utilisable, budget de performance tenu | **manuel** |

## À faire à la main (non automatisable ici)

1. **Lecteur d'écran réel** (X-5) : parcours inscription, achat, remise avec TalkBack sur Android.
2. **Appareil réel, réseau lent** (N-3) : mesurer le chargement de l'accueil et de la fiche sur un téléphone d'entrée de gamme, en 3G.
3. **Appareil photo** : prise de photo depuis le sélecteur natif sur Android (le test automatique envoie des fichiers).
4. **Photos HEIC (iPhone)** : le navigateur peut ne pas savoir les lire ; vérifier le message.
5. **SMS réels, PSP réel** : impossibles tant qu'aucun fournisseur n'est branché.
6. **Fuseaux et horloge du téléphone** sur de vrais appareils de la région.

## Couverture

À remplir après exécution (voir `bugs.md` pour les défauts) : cas exécutés, réussis, échoués, non construits, manuels.
