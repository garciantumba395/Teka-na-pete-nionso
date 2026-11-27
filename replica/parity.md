# Parité avec l'original

Date : 2026-11-27 · build `84c8349` · tests : 92/92 (factice), 93/93 (PostgreSQL), aucun S1 ni S2 ouvert (`bugs.md`).

## Verdict : **pas livrable**

14 des 24 fonctions indispensables ne sont pas faites (score fonctionnel **39,9 / 100**). Le M0 est une tranche verticale volontairement étroite (vendre, acheter, payer, remettre avec le code, retirer) : elle est solide, pas complète.

## Note sur le score de mise en page (19,9)

**Ne pas le lire comme une mesure.** Une seule comparaison est valable : le premier écran du fil (clone 390 px recadré à 844 px de haut, contre `ref-03-feed-fr.png`). Les autres références sont des planches composites (1 488 à 1 920 px de large, plusieurs écrans par image), sans équivalent d'état ou de taille dans le clone ; leurs scores (24 à 27) ont été écartés. De plus, la référence est un écran de démonstration avec d'autres annonces et d'autres proportions, et le clone ne s'est pas voulu fidèle au pixel (charte propre, `replica-brand` change les couleurs). Pour une vraie mesure : captures de l'original et du clone **au même viewport, dans le même état** (fil connecté, mêmes types d'annonces). Les captures de l'original ne sont pas versionnées (`replica/screens/` est ignoré) ; les images de diff non plus.

## Écarts de comportement (ce que les scores ne voient pas)

| Flux | L'original | Le clone | Décision |
| --- | --- | --- | --- |
| Inscription | e-mail / réseaux sociaux | téléphone + code SMS, aucun mot de passe | **garder** (adapté RDC) |
| Paiement | carte | mobile money asynchrone (attente de validation sur le téléphone, refus, paiement tardif remboursé) | **garder** |
| Remise | colis expédié, libération après 2 jours | remise en main propre, libération par code à 6 chiffres | **garder**, ajouter la libération automatique à 48 h (filet si le code n'est jamais saisi) |
| Problème | bouton « J'ai un problème », litige guidé | annulation seulement, avant la remise | **corriger** (must-have) |
| Contact | messagerie intégrée | aucune ; pas de moyen de convenir du lieu de rendez-vous | **corriger** (must-have, bloquant pour la remise en main propre) |
| Confiance | avis après commande | aucun | **corriger** |
| Distance | carte et rayon autour de la position | rayon autour d'une commune, sans GPS | **garder** (pas de permission de géolocalisation) |
| Horloge du téléphone | n.d. | durée restante donnée par le serveur (BUG-001) | **garder** |

## Les cinq prochaines choses à construire

1. **Messagerie acheteur-vendeur** (S07) : sans elle, la remise en main propre n'a pas de moyen de se fixer.
2. **Litige guidé et arbitrage** (S11) : l'argent est en séquestre, il faut une issue quand l'article n'est pas conforme.
3. **Libération automatique après 48 h** et **avis** (S13) : ferme la boucle de confiance.
4. **Signalement et modération** (S19) : indispensable avant tout public.
5. **Filtres taille, marque, état** : complète la recherche (must-have partiel).

Ensuite : favoris, notifications, livraison par coursier. Puis `/replica-entrepreneur` pour le positionnement, une fois la parité atteinte.

---

## Parity: 35.9 / 100

features 39.9  (51 counted, must-haves 10 of 24 done)
layout   19.9  (1 screens compared)

Not shippable yet: 14 must-have features are not done.

## By area, weakest first
- modération                     0.0  (3 features)
- messagerie                     0.0  (3 features)
- livraison                      0.0  (3 features)
- confiance                      0.0  (1 features)
- pro                            0.0  (2 features)
- monétisation                   0.0  (1 features)
- engagement                     0.0  (1 features)
- litiges                        7.1  (8 features)
- catalogue                     50.0  (1 features)
- découverte                    50.0  (9 features)
- plateforme                    50.0  (1 features)
- vente                         64.7  (9 features)
- compte                        85.7  (3 features)
- paiement                      91.7  (6 features)

## Missing, in build order
- [must] confiance: Avis après commande terminée uniquement, no  ([SRC] safety)
- [must] litiges: Arbitrage par le support si désaccord, no  ([SRC] refund policy)
- [must] litiges: Bouton « J'ai un problème » et litige guidé, no  ([SRC] refund policy)
- [must] litiges: Fenêtre de signalement de 2 jours calendaires, no  ([SRC] refund policy)
- [must] litiges: Motifs : non reçu / endommagé / non conforme, no  ([SRC] refund policy)
- [must] livraison: Suivi de colis en temps réel, no  ([SRC] how_it_works)
- [must] livraison: Étiquette d'expédition prépayée, no  ([SRC] how_it_works; à remplacer par logistique locale)
- [must] messagerie: Messagerie acheteur-vendeur, no  ([SRC] safety)
- [must] modération: Signalement d'annonces et de membres, no  ([SRC] safety)
- [must] catalogue: Catalogue de catégories autorisées / interdites, partial  ([SRC] catalog-rules; adapter la liste au marché local | M0 : arbre de catégories vendables. Règles des articles interdits et modération : non construites)
- [must] découverte: Recherche et filtres (catégorie/taille/marque/prix/état), partial  ([IMG] captures 5 à 7 : tri, catégorie, lieu, prix, taille, marque, état, matière, couleur, retrait en personne | M0 : mot-clé sans accents, catégorie, prix max, rayon. Taille, marque, état : non construits)
- [must] litiges: Remboursement complet (prix+frais+livraison+taxes), partial  ([SRC] refund policy | Remboursement intégral à l'annulation avant remise, y compris paiement tardif. Pas via litige)
- [must] paiement: Libération du paiement après 2 jours sans signalement, partial  ([SRC] refund policy | Libération par le code de remise construite. Libération automatique après 48 h : non construite)
- [must] plateforme: Application mobile iOS et Android, partial  ([SRC] /app | Web mobile responsive seulement : ni PWA installable ni application native)
- [should] découverte: Favoris, no  ([IMG] captures 1 à 5 : cœur et compteur sur chaque carte)
- [should] découverte: Fil personnalisé (tailles et marques suivies), no  ([IMG] capture 4 : bandeau d'invitation à personnaliser)
- [should] engagement: Notifications (push / email), no  ([INF])
- [should] litiges: Colis perdu : enquête après 25 jours ouvrés, no  ([SRC] refund policy; adapter aux délais locaux)
- [should] litiges: Photos obligatoires pour dommage, no  ([SRC] refund policy)
- [should] litiges: Retour sous 5 jours ouvrés (retour payé par l'acheteur), no  ([SRC] refund policy)
- [should] livraison: Dépôt en point relais ou collecte à domicile, no  ([SRC] how_it_works)
- [should] messagerie: Filtre anti-spam dans les messages, no  ([SRC] safety)
- [should] messagerie: Offres de prix / négociation, no  ([INF] à confirmer)
- [should] modération: Annonce masquée avec 24 h pour corriger, no  ([SRC] catalog-rules)
- [should] modération: Suspension (ex. 7 jours) ou blocage permanent, no  ([SRC] catalog-rules)
- [should] monétisation: Mise en avant payante d'annonce (bump), no  ([SRC] catalog-rules (existence); prix et mécanique non lus)
- [should] vente: Taille de colis choisie par le vendeur, no  ([IMG?] capture 6 « Package size »)
- [should] compte: Vérification de compte, partial  ([SRC] safety (existence confirmée) | Numéro vérifié seulement ; pièce d'identité non construite)
- [should] découverte: Recherche par rayon de distance avec carte, partial  ([IMG?] capture 7. Exige des coordonnées sur les annonces (schéma à compléter) | Rayon autour d'une commune (3 à 25 km), tri par distance. Pas de carte)
- [should] découverte: Retrait en personne (option et filtre), partial  ([IMG?] captures 6 et 7 (maquettes possibles). Mode par défaut en RDC | Seul mode de remise du MVP. Pas d'option ni de filtre)
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

## Screens
- /tmp/claude-0/-home-user-Teka-na-pete-nionso/18e167f0-e0a4-5a7c-bd1e-1a2ab549b12b/scratchpad/S01-fold.png  19.9
