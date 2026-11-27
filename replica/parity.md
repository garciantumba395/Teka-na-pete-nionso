# Parité avec l'original

Date : 2026-11-27 · après `/replica-build` tranches 1 et 2 · tests : 117 réussis (factice), 118 (PostgreSQL), 172 unitaires et contrat, aucun S1 ni S2 ouvert (`bugs.md`).

## Verdict : **pas livrable**

6 des 24 fonctions indispensables ne sont pas faites (score fonctionnel **61,3 / 100**, contre 39,9 avant cette tranche). Restent la livraison (suivi de colis, étiquette), l'application mobile native, le catalogue des articles interdits et la libération automatique après remise.

## Note sur le score de mise en page (19,9)

**Ne pas le lire comme une mesure.** Une seule comparaison est valable : le premier écran du fil (clone 390 px recadré à 844 px de haut, contre `ref-03-feed-fr.png`). Les autres références sont des planches composites (1 488 à 1 920 px de large, plusieurs écrans par image), sans équivalent d'état ou de taille dans le clone ; leurs scores (24 à 27) ont été écartés. De plus, la référence est un écran de démonstration avec d'autres annonces et d'autres proportions, et le clone ne s'est pas voulu fidèle au pixel (charte propre, `replica-brand` change les couleurs). Pour une vraie mesure : captures de l'original et du clone **au même viewport, dans le même état** (fil connecté, mêmes types d'annonces). Les captures de l'original ne sont pas versionnées (`replica/screens/` est ignoré) ; les images de diff non plus.

## Écarts de comportement (ce que les scores ne voient pas)

| Flux | L'original | Le clone | Décision |
| --- | --- | --- | --- |
| Inscription | e-mail / réseaux sociaux | téléphone + code SMS, aucun mot de passe | **garder** (adapté RDC) |
| Paiement | carte | mobile money asynchrone (attente de validation, refus, paiement tardif remboursé) | **garder** |
| Remise | colis expédié, libération 2 jours après livraison | remise en main propre, libération immédiate par code à 6 chiffres | **garder** ; filet : remboursement automatique après 7 jours sans remise |
| Problème | litige guidé après livraison | litige guidé AVANT la remise, arbitrage par l'assistance, argent gelé | **garder**, mais voir risque ci-dessous |
| Contact | messagerie intégrée | messagerie texte par annonce, rappel de sécurité sur numéro ou lien | **garder** ; ajouter photos et offres de prix plus tard |
| Confiance | avis après commande | avis des deux parties, note moyenne, profil public | **garder** |
| Distance | carte et rayon autour de la position | rayon autour d'une commune, sans GPS | **garder** (pas de permission de géolocalisation) |
| Modération | signalement, masquage, suspension, blocage | signalement, masquage, suspension de 7 jours | **corriger** : blocage permanent, délai de 24 h, notifications |

**Risque à arbitrer** : l'annulation par l'acheteur après paiement reste unilatérale. Un acheteur de mauvaise foi peut recevoir l'article, ne pas donner le code et annuler. Le litige du vendeur existe mais n'empêche pas l'annulation qui le précède. Recommandation : après paiement, remplacer l'annulation unilatérale de l'acheteur par un litige, sauf si le vendeur accepte d'annuler.

## Les cinq prochaines choses à construire

1. **Livraison** (3 fonctions indispensables à 0 %) : coursier local, suivi, point relais. C'est le plus gros écart restant et il dépend du choix du prestataire.
2. **Annulation encadrée** (risque ci-dessus) : petit changement, gros effet sur la confiance des vendeurs.
3. **Photos en preuve de litige et dans les messages** : l'assistance tranche aujourd'hui sans image.
4. **Notifications** (SMS ou push) : aucun membre n'est prévenu d'un message, d'un litige ou d'une vente.
5. **PWA installable et catalogue des articles interdits** : les deux dernières fonctions indispensables « partielles ».

Ensuite : favoris, fil personnalisé, tri de la recherche. Puis `/replica-entrepreneur` pour le positionnement.

---

## Parity: 61.3 / 100

features 61.3  (51 counted, must-haves 18 of 24 done)

Not shippable yet: 6 must-have features are not done.

## By area, weakest first
- livraison                      0.0  (3 features)
- pro                            0.0  (2 features)
- monétisation                   0.0  (1 features)
- engagement                     0.0  (1 features)
- catalogue                     50.0  (1 features)
- plateforme                    50.0  (1 features)
- messagerie                    57.1  (3 features)
- découverte                    57.9  (9 features)
- litiges                       64.3  (8 features)
- vente                         64.7  (9 features)
- modération                    71.4  (3 features)
- compte                        85.7  (3 features)
- paiement                      91.7  (6 features)
- confiance                    100.0  (1 features)

## Missing, in build order
- [must] livraison: Suivi de colis en temps réel, no  ([SRC] how_it_works)
- [must] livraison: Étiquette d'expédition prépayée, no  ([SRC] how_it_works; à remplacer par logistique locale)
- [must] catalogue: Catalogue de catégories autorisées / interdites, partial  ([SRC] catalog-rules; adapter la liste au marché local | M0 : arbre de catégories vendables. Règles des articles interdits et modération : non construites)
- [must] litiges: Fenêtre de signalement de 2 jours calendaires, partial  ([SRC] refund policy | M1 : le litige se tranche AVANT la remise (le code vaut acceptation et libère l'argent) ; pas de fenêtre de 2 jours après remise)
- [must] paiement: Libération du paiement après 2 jours sans signalement, partial  ([SRC] refund policy | Libération par le code de remise construite. Libération automatique après 48 h : non construite | Libération par le code de remise (immédiate). Filet : commande payée jamais remise au bout de 7 jours (PLACEHOLDER) = remboursement automatique de l'acheteur)
- [must] plateforme: Application mobile iOS et Android, partial  ([SRC] /app | Web mobile responsive seulement : ni PWA installable ni application native)
- [should] découverte: Favoris, no  ([IMG] captures 1 à 5 : cœur et compteur sur chaque carte)
- [should] découverte: Fil personnalisé (tailles et marques suivies), no  ([IMG] capture 4 : bandeau d'invitation à personnaliser)
- [should] engagement: Notifications (push / email), no  ([INF])
- [should] litiges: Colis perdu : enquête après 25 jours ouvrés, no  ([SRC] refund policy; adapter aux délais locaux)
- [should] litiges: Photos obligatoires pour dommage, no  ([SRC] refund policy)
- [should] litiges: Retour sous 5 jours ouvrés (retour payé par l'acheteur), no  ([SRC] refund policy)
- [should] livraison: Dépôt en point relais ou collecte à domicile, no  ([SRC] how_it_works)
- [should] messagerie: Offres de prix / négociation, no  ([INF] à confirmer)
- [should] monétisation: Mise en avant payante d'annonce (bump), no  ([SRC] catalog-rules (existence); prix et mécanique non lus)
- [should] vente: Taille de colis choisie par le vendeur, no  ([IMG?] capture 6 « Package size »)
- [should] compte: Vérification de compte, partial  ([SRC] safety (existence confirmée) | Numéro vérifié seulement ; pièce d'identité non construite)
- [should] découverte: Recherche par rayon de distance avec carte, partial  ([IMG?] capture 7. Exige des coordonnées sur les annonces (schéma à compléter) | Rayon autour d'une commune (3 à 25 km), tri par distance. Pas de carte)
- [should] découverte: Retrait en personne (option et filtre), partial  ([IMG?] captures 6 et 7 (maquettes possibles). Mode par défaut en RDC | Seul mode de remise du MVP. Pas d'option ni de filtre)
- [should] messagerie: Filtre anti-spam dans les messages, partial  ([SRC] safety | Détection de numéro et de lien : message remis avec un rappel (pas de blocage ni de modération))
- [should] modération: Annonce masquée avec 24 h pour corriger, partial  ([SRC] catalog-rules | M1 : masquage par la modération ; pas de délai de 24 h pour corriger ni de notification)
- [should] modération: Suspension (ex. 7 jours) ou blocage permanent, partial  ([SRC] catalog-rules | M1 : suspension de 7 jours (sessions coupées, actions refusées). Pas de blocage permanent)
- [should] vente: Lots (bundles) avec prix total affiché, partial  ([SRC] catalog-rules | Serveur seulement (commande multi-articles du même vendeur). Pas d'interface de sélection)
- [could] découverte: Marques récentes dans la recherche de marque, no  ([IMG?] capture 6)
- [could] découverte: Recherche enregistrée (marque-page), no  ([IMG?] capture 7)
- [could] pro: Compte Pro avec vérification société, no  ([SRC] vinted.fr/pro)
- [could] pro: Retour 14 jours obligatoire pour vendeurs Pro, no  ([SRC] pro; dépend du droit local)
- [could] vente: Choix des matières (max 3), no  ([SRC] catalog-rules)
- [could] vente: Couleurs de l'article (jusqu'à 2), no  ([IMG?] capture 6)
- [could] vente: Intérêt pour l'échange (swap), no  ([IMG?] capture 6)

## Left out on purpose (not scored)
- Scoring de risque prédictif (fraude): [SRC] safety; basé sur les données de l'original; version simple à la place
- Rapports de transparence DSA: [SRC] safety; obligation UE sans équivalent direct
- Vinted Go (casiers automatiques): [SRC] newsroom; matériel et partenariats hors périmètre
- Régie publicitaire B2B: [SRC] /advertising; hors périmètre initial
- Réseau de membres et catalogue existant: l'audience n'est pas clonable
- Connexion avec Facebook, Google ou Apple: [IMG] capture 4. Remplacée par téléphone + OTP (identité = numéro)

## Yours, not in the original (not scored)
- Paiement mobile money (M-Pesa / MTN MoMo / Orange Money / Airtel / Wave)
- Paiement à la livraison (option)
- Remise en main propre avec code de confirmation
- Livreurs et coursiers locaux (motos) intégrés
- Localisation par repère / partage de position
- Mode léger : PWA et images compressées
- Multilingue (FR / EN + langues locales)
- Multi-devises locales et plafonds adaptés
- Partage d'annonce et notifications WhatsApp
- Vérification par numéro de téléphone (puis pièce d'identité)
