# Recon map: Vinted (web + iOS + Android)

Scope: tout le produit (marketplace C2C de seconde main : vendre, acheter, expédier, payer, protéger), plus le compte Pro.
For: clone adapté à l'Afrique, nom à définir à l'étape `/replica-brand`.
Date: 2026-11-27
Méthode : sources publiques uniquement, sans compte, sans crawler, sans lecture du code ni des API privées.

## Niveau de preuve (à lire en premier)

Les articles du centre d'aide Vinted sont rendus côté client : un fetch simple ne renvoie que la navigation. Seules 7 pages ont livré du contenu réel. Tout ce qui n'est pas dans ces pages est marqué **[INF]** (déduit des schémas standard d'une marketplace, à vérifier avec ton propre compte ou des vidéos publiques) et jamais présenté comme un fait sur Vinted.

- **[SRC]** = lu dans une source citée ci-dessous.
- **[INF]** = hypothèse de travail, confiance `guess` ou `medium`.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | Comment ça marche | https://www.vinted.com/how_it_works | contenu rendu : vente sans frais vendeur, frais acheteur, étiquette prépayée |
| 2 | Politique de remboursement | https://www.vinted.com/help/465-the-vinted-refund-policy | contenu rendu, très complet (délais, motifs, retours) |
| 3 | Règles du catalogue | https://www.vinted.com/catalog-rules | contenu rendu : catégories, interdits, limites d'annonce |
| 4 | Sécurité | https://www.vinted.com/safety | séquestre, avis, scoring de risque, rapports DSA |
| 5 | Vinted Pro (FR) | https://www.vinted.fr/pro | comptes professionnels, 14 jours de retour obligatoires |
| 6 | Appli mobile | https://www.vinted.com/app | marketing seulement, pas de liste de fonctions |
| 7 | Publicité | https://www.vinted.com/advertising | canal B2B annonceurs, formulaire seulement |
| 8 | Newsroom | https://company.vinted.com/ | titres seuls : Vinted Go (Finlande, 9 nov. 2026), lancement Australie (7 sept. 2026), Q&R vente commerciale (24 sept. 2026), résultats 2025 |
| 9 | Centre d'aide (Vente, Achat) | https://www.vinted.com/help/4-selling , /5-buying | **navigation seule, aucun contenu** |
| 10 | Fiche Google Play | play.google.com/store/apps/details?id=fr.vinted | page vide (stub) |
| 11 | Fiche App Store | apps.apple.com/app/vinted/id632064158 | 404 |

Contradictions relevées : « 75 millions de membres » (/app) contre « plus de 80 millions » (/advertising), sans doute des dates ou périmètres différents. Ne pas citer l'un ou l'autre sans date. Les chiffres financiers 2025 (GMV 10,8 Md€, ~1,1 Md€ de revenus) sont des titres de newsroom non vérifiés dans le corps des articles.

## Core loop

Un particulier photographie un objet, le met en vente à prix fixe sans frais vendeur, un acheteur le paie via un paiement protégé dont les fonds sont séquestrés, l'objet est expédié avec une étiquette prépayée, et l'argent est libéré au vendeur quand l'acheteur confirme ou laisse passer la fenêtre de 2 jours. **[SRC 1, 2, 4]**

Le modèle économique : **0 frais vendeur, frais de protection ajoutés côté acheteur** **[SRC 1]** (montant exact non lu : à vérifier).

## Screens

Écrans 100 % sourcés sont rares ; la colonne « preuve » distingue.

| ID | screen | route / accès | purpose | key components | states seen | preuve |
| --- | --- | --- | --- | --- | --- | --- |
| S01 | Accueil / fil | `/` | découvrir des annonces | grille d'annonces, barre de recherche, catégories | vide, chargé, erreur | INF |
| S02 | Inscription / connexion | modale ou `/member/signup` | créer ou ouvrir un compte | email, réseaux sociaux, vérification | erreur, vérifié | INF (vérification de compte : SRC 4) |
| S03 | Catalogue / résultats | `/catalog` | parcourir et filtrer | filtres (catégorie, taille, marque, état, prix), tri | vide, chargé | INF |
| S04 | Détail d'annonce | `/items/{id}` | décider d'acheter | galerie photos, prix, description, vendeur, frais, boutons Acheter / Message / Favori | disponible, vendu, réservé | INF |
| S05 | Création d'annonce | `/items/new` | mettre en vente | upload jusqu'à **20 photos**, catégorie, matière (max **3**), prix, état, colis | brouillon, erreur, masquée (24 h pour corriger) | SRC 3 + INF |
| S06 | Lot (bundle) | depuis profil vendeur | acheter plusieurs articles | sélection multiple, prix total affiché | SRC 3 |
| S07 | Messagerie / conversation | `/inbox` | questions, offres, litiges | fils, filtre anti-spam, bouton « J'ai un problème » | vide, actif | SRC 2, 4 |
| S08 | Paiement (Buy now) | flux modal | payer | récap, frais de protection, mode de livraison, paiement | erreur paiement | SRC 1, 2 |
| S09 | Suivi de commande | `/orders/{id}` | suivre, confirmer, signaler | statut, suivi colis, bouton « J'ai un problème », confirmer réception | expédié, livré, litige, remboursé | SRC 1, 2 |
| S10 | Étiquette et dépôt | écran vendeur | expédier | étiquette prépayée, point relais ou collecte à domicile | SRC 1 |
| S11 | Litige / remboursement | dans S07 | demander un remboursement | motifs, photos obligatoires, étapes guidées | ouvert, suspendu, résolu | SRC 2 |
| S12 | Retour | depuis S11 | renvoyer l'article | étiquette retour (optionnelle), délai 5 jours ouvrés | SRC 2 |
| S13 | Avis | après commande terminée | noter l'autre partie | note, commentaire | SRC 4 |
| S14 | Profil public | `/member/{id}` | réputation et boutique | articles, avis, badge vérifié, infos Pro | SRC 4, 5 |
| S15 | Mon profil / paramètres | `/settings` | compte, vérification, notifications | formulaires | INF (profil, vérification : SRC 4) |
| S16 | Solde / paiements | portefeuille | voir et retirer les gains | solde, historique, retrait | INF (aucune source lue) |
| S17 | Favoris | `/favourite_items` | garder des articles | liste | INF |
| S18 | Inscription Pro | `/help/906`, `/pro` | compte professionnel | identité société, numéro d'enregistrement | SRC 5 |
| S19 | Signalement / modération | menu ⋯ | signaler | motif, preuve | SRC 4 |
| S20 | Pages légales | CGU, confidentialité, cookies, standards | | | SRC 5 |

## Flows

```
F01 Vendre un article
    S05 création -> (annonce publiée) -> S07 réception de message/achat -> S10 étiquette -> dépôt -> S09 livré -> paiement libéré
    happy path clics : ~6 (photos, détails, prix, publier, étiquette, dépôt)  [INF]
    edge : annonce masquée (corriger sous 24 h), objet interdit, valeur > 1000 USD [SRC 3], compte non vérifié

F02 Acheter un article (Buy now)
    S01/S03 -> S04 -> S08 paiement -> S09 suivi -> confirmer réception ou S11
    edge : fenêtre de 2 jours calendaires pour signaler [SRC 2], paiement hors plateforme non protégé [SRC 2]

F03 Litige et remboursement
    S09 -> "J'ai un problème" -> S11 -> (accord) remboursement | (désaccord) support Vinted
    règles : colis perdu seulement après "semble perdu" ou 25 jours ouvrés [SRC 2]; retour sous 5 jours ouvrés, retour payé par l'acheteur [SRC 2]
    remboursement complet inclut frais Vinted, prix, livraison, taxes [SRC 2]

F04 Acheter un lot
    S06 -> S08 (un seul paiement pour plusieurs articles) [SRC 3 + INF]

F05 Négocier / poser une question
    S04 -> S07 (messages ; offre de prix = INF)

F06 Laisser un avis
    S09 terminé -> S13 -> S14 mis à jour [SRC 4]

F07 Devenir vendeur Pro
    S18 -> vérification société -> S14 profil avec mentions légales [SRC 5]
    contrainte : retour 14 jours obligatoire pour les acheteurs [SRC 5]

F08 Modération
    S19 -> traitement -> annonce masquée -> correction sous 24 h -> suspension (ex. 7 jours) ou blocage [SRC 3]
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Carte d'annonce | grille, liste | normal, vendu, favori | S01, S03, S14, S17 |
| Galerie photos | carrousel jusqu'à 20 | chargement, zoom | S04, S05 |
| Barre de recherche + filtres | tiroir mobile, panneau web | actif, vide | S01, S03 |
| Sélecteurs (catégorie, taille, marque, état, matières ≤ 3) | liste, multi | erreur | S05, S03 |
| Champ prix | prix fixe, devise | erreur (valeur max) | S05 |
| Bulle de message | texte, système | envoyé, lu, filtré (spam) | S07 |
| Bandeau de statut commande | à expédier, expédié, livré, litige | | S09 |
| Boutons | primaire, secondaire, danger, désactivé | chargement | tous |
| Badge vérifié / Pro | | | S14 |
| Étoiles d'avis | | | S13, S14 |
| Modale de confirmation | | | S08, S11 |
| Toast / notification | | | tous |

## Inferred data model

```
User            id, email, phone?, country, verified (bool), is_pro (bool), created_at
                evidence: S02, S15, SRC 4 (vérification), SRC 5 (compte Pro)
                confidence: high
ProProfile      user_id, business_name, registration_number, address, return_policy
                evidence: SRC 5 (affichage de ces champs au public)
                confidence: high
Item            id, seller_id, title, description, category_id, condition, size?, brand?,
                materials[≤3], price, currency, status (active|hidden|sold|reserved), photos[≤20]
                evidence: S05, SRC 3 (limites 20 photos, 3 matières, 1000 USD max)
                confidence: high (champs exacts), medium (liste complète)
Photo           id, item_id, url, position
                confidence: high
Category        id, parent_id, name, rules (interdits)
                evidence: SRC 3
                confidence: high
Bundle          id, seller_id, item_ids[], total_price
                evidence: SRC 3 (lots avec prix total affiché)
                confidence: medium
Conversation    id, item_id, buyer_id, seller_id, spam_flags
                evidence: S07, SRC 4
                confidence: high
Message         id, conversation_id, sender_id, body, kind (user|system|offer?)
                confidence: medium
Order           id, item_ids[], buyer_id, seller_id, status, item_price, shipping_price,
                protection_fee, tax, total, created_at, delivered_at, accepted_at
                evidence: SRC 1, 2 (composants du remboursement)
                confidence: high
Shipment        id, order_id, label_url, carrier, tracking, status (lost-flag after 25 business days)
                evidence: SRC 1, 2
                confidence: high
Payment         id, order_id, status (held|released|refunded), provider_ref
                evidence: SRC 4 (séquestre, prestataires tiers)
                confidence: high
Dispute         id, order_id, reason (not_received|damaged|not_as_described), photos[], status, resolution
                evidence: SRC 2
                confidence: high
Return          id, dispute_id, label_url?, deadline (5 jours ouvrés), shipping_paid_by
                evidence: SRC 2
                confidence: high
Review          id, order_id, author_id, target_id, rating, comment
                evidence: SRC 4 (seulement après commande terminée)
                confidence: high
Favourite       user_id, item_id
                confidence: guess
Wallet/Payout   user_id, balance, payout_method, payout_status
                evidence: aucune source lue
                confidence: guess
Report          id, reporter_id, target (item|user|message), reason, status
                evidence: SRC 4
                confidence: medium
Sanction        id, user_id, kind (hide|suspend 7d|ban), reason
                evidence: SRC 3
                confidence: medium
```

Relations : User 1-n Item, Item 1-n Photo, Item n-1 Category, Conversation n-1 Item, Order n-1 Item (n-n via lot), Order 1-1 Shipment, Order 1-1 Payment, Order 1-n Dispute, Dispute 0-1 Return, Order 1-2 Review, User 1-0..1 ProProfile.

## Feature matrix

Voir `features.csv`. Préfixes dans `notes` : `[SRC]` sourcé, `[INF]` déduit, `[AFR]` ajout propre à l'adaptation Afrique (original = no, exclu du score).

## Out of scope (cannot or should not be cloned)

- **Le réseau et les utilisateurs** : les dizaines de millions de membres et l'offre existante (liquidité). Aucun clone ne les hérite.
- **Marque, logo, textes, illustrations, polices et photos** de Vinted : tout est réécrit et redessiné. Le balayage `/replica-brand` doit passer avant tout déploiement.
- **Contrats transporteurs et partenaires de paiement de Vinted** : à renégocier localement.
- **Vinted Go (casiers)** : matériel et partenariats, pas un simple logiciel.
- **Scoring de risque prédictif et modération à grande échelle** : on construit une version simple ; la performance de l'original repose sur ses données.
- **Rapports DSA** : obligation européenne, sans équivalent direct (voir risques juridiques locaux).
- **Régie publicitaire** (formulaire B2B) : hors périmètre initial.

## Adaptation Afrique : hypothèses à valider (propositions, non issues de Vinted)

| Sujet | Constat | Proposition |
| --- | --- | --- |
| Paiement | La carte bancaire est minoritaire ; le mobile money domine dans plusieurs marchés (M-Pesa, MTN MoMo, Orange Money, Airtel Money, Wave) | Mobile money en premier, séquestre via un agrégateur (Flutterwave, Paystack, CinetPay, PawaPay à comparer), paiement à la livraison en option |
| Séquestre | Le modèle « argent bloqué jusqu'à confirmation » reste la clé de la confiance | Le garder, avec fenêtre de confirmation adaptée aux délais locaux |
| Livraison | Peu d'étiquettes prépayées universelles, peu de points relais | Livreurs et coursiers locaux (motos), points relais partenaires, remise en main propre avec code de confirmation |
| Adresses | Adressage souvent informel | Localisation par repère, carte, partage de position, numéro de téléphone du livreur |
| Connexion | Réseau mobile inégal, forfaits de données chers | PWA légère, images compressées, mode hors-ligne partiel, appli Android d'abord |
| Langues | Multilingue | Français, anglais, puis langues locales (swahili, hausa, wolof, lingala selon marché) |
| Monnaies | Plusieurs devises, inflation variable | Prix dans la devise locale, plafond de valeur adapté (le 1000 USD de Vinted n'a pas de sens partout) |
| Canaux | WhatsApp très utilisé | Partage d'annonce et notifications WhatsApp |
| Identité / confiance | Peu de pièces d'identité numérisées | Vérification par téléphone, puis pièce d'identité optionnelle |
| Réglementation | Varie par pays (paiements, e-commerce, données, KYC) | Choisir 1 pays pilote, avis juridique local avant lancement |

## Size

Screens 20, flows 8, entities ~19. Hard parts :
1. **Paiement avec séquestre et remboursements** (mobile money, réconciliation, litiges).
2. **Logistique** (étiquettes, livreurs locaux, suivi, colis perdus).
3. **Confiance et modération** (fraude, anti-spam, vérification, litiges).
4. **Recherche et catalogue** (filtres, tailles, qualité des photos, performance sur mobile à faible débit).
5. **Liquidité** (problème d'amorçage du marché, non technique).

Size : **L** (un trimestre pour un MVP solide sur un pays, avec une équipe de 3 à 5). XL si multi-pays, multi-devises et logistique propre dès le départ. À rescoper : commencer par un pays et une ville.

## Lacunes à combler avant `/replica-architect`

1. Montant et structure des **frais de protection acheteur** (page frais non rendue).
2. Mécanique des **bumps / mise en avant**, du **portefeuille** et du **retrait** (aucune source lue).
3. Fonctions exactes de l'appli (liste d'écrans de la fiche store, non récupérée).
4. Offres de prix / négociation, filtres exacts, notifications.

Pistes sans compte : captures d'écran des fiches stores consultées dans un navigateur, vidéos publiques de prise en main, articles de blog et presse. Avec ton propre compte (CGU à vérifier), le parcours réel couvrirait ces points en une heure.
