# Parité avec l'original

Date : 2026-11-27 · après `/replica-build` tranches 1 à 4 (neuf agents en parallèle au total) · tests : 205 réussis (factice), 206 (PostgreSQL), 488 unitaires et contrat, aucun S1 ni S2 ouvert (`bugs.md`).

## Verdict : **pas livrable** (mais proche)

3 des 24 fonctions indispensables ne sont pas faites (score fonctionnel **73,1 / 100**, contre 68,9 avant cette tranche et 39,9 au début) : l'étiquette d'expédition prépayée (remplacée ici par la livraison par coursier local, donc à reclasser ou à écarter), le suivi de colis en temps réel (manuel seulement) et l'application mobile native (seule la version installable existe). Les trois dépendent d'une décision métier ou d'un prestataire, pas de code. Ce qui sépare réellement du pilote est ailleurs : fournisseur de paiement, fournisseur SMS, avis juridique (voir `replica/decisions/`).

## Note sur le score de mise en page (19,9)

**Ne pas le lire comme une mesure.** Une seule comparaison est valable : le premier écran du fil (clone 390 px recadré à 844 px de haut, contre `ref-03-feed-fr.png`). Les autres références sont des planches composites (1 488 à 1 920 px de large, plusieurs écrans par image), sans équivalent d'état ou de taille dans le clone ; leurs scores (24 à 27) ont été écartés. De plus, la référence est un écran de démonstration avec d'autres annonces et d'autres proportions, et le clone ne s'est pas voulu fidèle au pixel (charte propre, `replica-brand` change les couleurs). Pour une vraie mesure : captures de l'original et du clone **au même viewport, dans le même état** (fil connecté, mêmes types d'annonces). Les captures de l'original ne sont pas versionnées (`replica/screens/` est ignoré) ; les images de diff non plus.

## Écarts de comportement (ce que les scores ne voient pas)

| Flux | L'original | Le clone | Décision |
| --- | --- | --- | --- |
| Inscription | e-mail / réseaux sociaux | téléphone + code SMS, aucun mot de passe | **garder** (adapté RDC) |
| Paiement | carte | mobile money asynchrone (attente, refus, paiement tardif remboursé) | **garder** |
| Remise | colis expédié, libération 2 jours après livraison | main propre (code, libération immédiate) **ou** coursier local (libération à 48 h après réception) | **garder** |
| Annulation | libre jusqu'à l'expédition | libre avant paiement ; après paiement, demande que le vendeur accepte, sinon litige | **garder** (protège le vendeur) |
| Problème | litige guidé après livraison | litige guidé avant remise, ou pendant 48 h après réception ; preuves en photos privées ; arbitrage par l'assistance | **garder** |
| Contact | messagerie intégrée | messagerie texte et photo par annonce, rappel de sécurité sur numéro ou lien | **garder** ; ajouter offres de prix |
| Confiance | avis après commande | avis des deux parties, note moyenne | **garder** |
| Modération | signalement, masquage, suspension, blocage | idem sauf blocage permanent ; catalogue d'articles interdits à la publication | **corriger** : blocage, délai de 24 h pour corriger |
| Prévenir les membres | notifications | centre + pastille + 3 SMS critiques ; **trous** : demande d'annulation et étapes du coursier ne notifient personne | **corriger** |
| Application | iOS et Android natifs | web installable, page hors-ligne | **garder** pour le pilote |

## Les cinq prochaines choses à construire ou à décider

1. **Choisir le fournisseur de paiement mobile money et le fournisseur SMS** : `replica/decisions/01` et `02`. Tout fonctionne avec des factices ; c'est le vrai bloc avant tout lancement. **À faire par vous** (comptes, clés).
2. **Avis juridique** : `replica/decisions/03`, en premier la question du séquestre (agrément ou licence du fournisseur de paiement), avant de signer.
3. **Vérifier le montant des webhooks de paiement** : l'événement n'a ni montant ni devise ; à corriger en même temps que l'adaptateur du fournisseur choisi (Claude, après le choix).
4. **Multilingue** (français, anglais, lingala, swahili) : seule fonction indispensable « non faite » côté code. Touche tout le texte de l'interface, donc à faire seul, sans autre chantier en parallèle ; les langues locales demandent une relecture par des locuteurs.
5. **Test sur un vrai téléphone** (service worker, installation, appareil photo, photos HEIC, 3G lente) : `replica/decisions/04`.

Ensuite : offres de prix, carte de recherche, retours, compte Pro. Puis `/replica-entrepreneur` pour le positionnement : la parité fonctionnelle du cœur est atteinte.

---

## Parity: 73.1 / 100

features 73.1  (51 counted, must-haves 21 of 24 done)

Not shippable yet: 3 must-have features are not done.

## By area, weakest first
- pro                            0.0  (2 features)
- monétisation                   0.0  (1 features)
- livraison                     18.8  (3 features)
- engagement                    50.0  (1 features)
- plateforme                    50.0  (1 features)
- messagerie                    57.1  (3 features)
- vente                         70.6  (9 features)
- modération                    71.4  (3 features)
- découverte                    78.9  (9 features)
- litiges                       81.0  (8 features)
- compte                        85.7  (3 features)
- catalogue                    100.0  (1 features)
- paiement                     100.0  (6 features)
- confiance                    100.0  (1 features)

## Missing, in build order
- [must] livraison: Étiquette d'expédition prépayée, no  ([SRC] how_it_works; à remplacer par logistique locale)
- [must] livraison: Suivi de colis en temps réel, partial  ([SRC] how_it_works | Frise et historique horodaté renseignés à la main par le vendeur (coursier indépendant) ; pas de suivi en temps réel ni d'intégration à un transporteur)
- [must] plateforme: Application mobile iOS et Android, partial  ([SRC] /app | Application web installable (PWA) ; aucune application native ni publication sur les boutiques)
- [should] litiges: Retour sous 5 jours ouvrés (retour payé par l'acheteur), no  ([SRC] refund policy)
- [should] livraison: Dépôt en point relais ou collecte à domicile, no  ([SRC] how_it_works)
- [should] messagerie: Offres de prix / négociation, no  ([INF] à confirmer)
- [should] monétisation: Mise en avant payante d'annonce (bump), no  ([SRC] catalog-rules (existence); prix et mécanique non lus)
- [should] vente: Taille de colis choisie par le vendeur, no  ([IMG?] capture 6 « Package size »)
- [should] compte: Vérification de compte, partial  ([SRC] safety (existence confirmée) | Numéro vérifié seulement ; pièce d'identité non construite)
- [should] découverte: Recherche par rayon de distance avec carte, partial  ([IMG?] capture 7. Exige des coordonnées sur les annonces (schéma à compléter) | Rayon autour d'une commune (3 à 25 km), tri par distance. Pas de carte)
- [should] découverte: Retrait en personne (option et filtre), partial  ([IMG?] captures 6 et 7 (maquettes possibles). Mode par défaut en RDC | Seul mode de remise du MVP. Pas d'option ni de filtre)
- [should] engagement: Notifications (push / email), partial  ([INF] | Notifications internes (22 types) + pastille ; SMS pour 5 événements (commande payée, litige ouvert et résolu, demande d'annulation, colis remis) avec préférences et plafond de 5 par jour et par numéro (fournisseur console factice) ; rappels et expirations par tâche planifiée. Pas de push ni d'e-mail)
- [should] litiges: Colis perdu : enquête après 25 jours ouvrés, partial  ([SRC] refund policy; adapter aux délais locaux | « Colis non reçu » ouvre un litige ; remboursement automatique après 10 jours (PLACEHOLDER) sans livraison. Pas d'enquête transporteur)
- [should] litiges: Photos obligatoires pour dommage, partial  ([SRC] refund policy | Photos de preuve privées (6 par membre et par litige), facultatives : pas obligatoires pour le motif « abîmé »)
- [should] messagerie: Filtre anti-spam dans les messages, partial  ([SRC] safety | Détection de numéro et de lien : message remis avec un rappel (pas de blocage ni de modération))
- [should] modération: Annonce masquée avec 24 h pour corriger, partial  ([SRC] catalog-rules | M1 : masquage par la modération ; pas de délai de 24 h pour corriger ni de notification)
- [should] modération: Suspension (ex. 7 jours) ou blocage permanent, partial  ([SRC] catalog-rules | M1 : suspension de 7 jours (sessions coupées, actions refusées). Pas de blocage permanent)
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
