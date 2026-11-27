# Composants : spécifications

Source : `tokens.json` (valeurs), `primitives.css` (référence CSS pure), `preview.html` (rendu).
Écrans : identifiants `S01`… de `replica/recon.md`. Tous les libellés sont écrits pour ce produit, aucun n'est repris de l'original.
Les primitives React (Radix / shadcn/ui) de `/replica-build` reproduisent ces règles. Jamais de valeur brute : seulement des jetons.

Règles communes à tous les composants :
- **Cible tactile ≥ 44 px** (`size.touch-min`). Les actions principales font 44 à 52 px.
- **Focus visible** : anneau 2 px `accent`, décalage 2 px. Jamais supprimé.
- **États minimaux** : par défaut, survol, actif, focus, désactivé, chargement, erreur, vide, quand ils s'appliquent.
- **Mouvement réduit** : `prefers-reduced-motion` ramène les durées à ~0 et coupe les animations d'attente.
- **Le texte ne porte jamais seul l'information** : un état se lit aussi par icône ou libellé (daltonisme, plein soleil).
- **Libellés courts, en français d'abord**, tous issus d'un fichier de traductions (lingala et swahili plus tard). Prévoir +30 % de longueur.

## Actions

```
Button
  variants  primary, secondary, ghost, danger
  sizes     sm 36px, md 44px, lg 52px (pleine largeur sur mobile)
  states    default, hover, active, focus-visible, disabled, loading
  tokens    primary : bg accent, texte on-accent, survol accent-strong. secondary : bord accent, texte accent-strong
            radius sm (4px), police sm/600
  a11y      vrai <button> ou <a>, loading = aria-busy et le libellé reste lisible, disabled = aria-disabled si une explication est utile
  used on   S02, S04, S05, S08, S09, S11
IconButton
  sizes     44px (zone tactile), icône 24px
  a11y      aria-label obligatoire (« Fermer », « Retour », « Filtres »)
  used on   toutes les barres
```

## Champs et saisie

```
TextField
  parts     label au-dessus (toujours visible), champ 48px, aide, erreur
  states    default, focus, rempli, erreur (bord danger + message + aria-invalid + aria-describedby), désactivé
  tokens    bord border-input (3,7:1), radius sm, texte base
  a11y      label lié par for/id, l'erreur n'est pas que rouge, autocomplete et inputmode corrects
  used on   S02, S05, S15
PhoneField
  parts     préfixe +243 (fixe, non modifiable au pilote) + champ national
  a11y      inputmode="tel", autocomplete="tel-national", accepte « 081… » et « 81… » puis normalise en E.164
  used on   S02, S15, S16 (numéro de retrait)
OTPInput
  parts     6 cases de 48px
  behaviour collage du code entier, saut automatique, retour arrière, autocomplete="one-time-code"
  states    erreur (« Code incorrect »), expiré (renvoi après compte à rebours), verrouillé (trop d'essais)
  a11y      groupe étiqueté, chaque case a un aria-label « Chiffre n »
  used on   S02
SearchBar
  parts     icône, champ, effacer
  tokens    bg surface, radius md, hauteur 48px
  states    repos, focus (anneau), saisie avec suggestions (marques récentes)
  used on   S01, S03
Select (ligne à valeur)
  parts     libellé à gauche, valeur à droite en accent-strong, chevron ; ouvre une feuille ou un écran
  used on   S05 (catégorie, taille, état, couleur), S03 (filtres)
Toggle, Checkbox, Radio, Slider
  Toggle    48x28, piste border-input, active accent ; Checkbox/Radio : 22px dans une ligne de 44px
  Slider    natif <input type=range>, 44px de haut, valeur affichée à côté
  a11y      natifs, l'état est annoncé, la ligne entière est cliquable
  used on   S03 (retrait en main propre, couleurs, distance), S15
LandmarkField
  parts     commune (liste), repère en texte libre, bouton « Partager ma position » (facultatif)
  note      pas d'adresse postale obligatoire ; conseille un lieu public pour la remise
  used on   S08, S05 (lieu de l'annonce)
CurrencySwitch
  parts     contrôle segmenté USD / CDF
  behaviour change l'affichage, pas la devise du prix de l'annonce ; l'écart de change est annoncé au paiement
  used on   S01, S08, S16
```

## Navigation et structure

```
TopAppBar
  parts     retour, titre, action(s) ; hauteur 56px
  used on   tous les écrans internes
BottomTabBar
  tabs      Accueil, Chercher, Vendre, Messages, Profil (5, libellés toujours visibles)
  states    actif = accent-strong + aria-current="page" ; pastille de notification sur Messages
  a11y      <nav aria-label>, 44px minimum par onglet
  used on   S01, S03, S07, S14, S15
Tabs
  tokens    texte muted, actif accent-strong + trait 2px accent
  used on   S01 (catégories), S03 (femme, homme, enfant)
Chip (filtre)
  variants  simple, avec compteur, déroulant, retirable ; hauteur 36px, radius pill
  states    inactif (bord border-input), actif (bg accent-subtle, bord accent)
  a11y      aria-pressed ; défilement horizontal avec focus visible
  used on   S03
ListRow
  parts     icône, libellé, valeur, chevron ; hauteur ≥ 48px ; séparateur border
  used on   S03, S15, S16
BottomSheet
  parts     poignée, titre, contenu, actions ; radius lg en haut, scrim overlay
  a11y      role="dialog", piège de focus, Échap et glissement ferment, le focus revient au déclencheur
  used on   S02 (connexion), S08 (paiement), sélecteurs
```

## Annonces

```
ListingCard
  parts     photo 3:4 (flou 20px en attente), prix (tabulaire), prix avec protection, marque · taille · état, cœur + compteur
  variants  normal, remisé (ancien prix barré + nouveau), à proximité (étiquette), vendu (barre « Vendu »)
  states    chargement (squelette), erreur d'image (fond surface + icône), favori actif
  tokens    radius sm, prix price (16/700), méta xs muted
  a11y      toute la carte est un seul lien ; le cœur est un bouton séparé (aria-pressed, aria-label « Ajouter aux favoris »)
  perf      srcset 160/320/640, loading="lazy", dimensions réservées pour éviter les sauts
  used on   S01, S03, S14, S17
ListingGrid
  columns   2 (mobile), 3 (≥480), 4 (≥768), 5 (≥1120) ; gouttière 8px
  states    chargement (squelettes), vide (EmptyState), fin de liste, erreur réseau avec « Réessayer »
  behaviour pagination par curseur, pas de défilement infini sans bouton de repli en mode économie de données
PriceTag
  parts     prix principal ; sous-ligne « avec protection » + icône bouclier en success
  rule      le prix incluant la protection est montré dès la liste, pas seulement au paiement
  format    USD « 12,50 $ », CDF « 35 000 FC » ; séparateur de milliers = espace insécable ; vérifier le rendu de Intl avec fr-CD
PhotoGallery
  parts     image, points de pagination, pastille cœur, bandeau d'état sous la photo (« Vendu », « Réservé »)
  a11y      alternative textuelle « Photo 2 sur 5 », flèches clavier, pas de piège au swipe
  used on   S04
PhotoCapture
  parts     aperçu, fermer, flash, retourner, bouton de déclenchement, « Suivant », miniatures, 20 photos max
  fallback  choisir depuis la galerie si la caméra est refusée
  perf      compression côté client (1280px, qualité ~72), envoi reprenable, barre de progression par photo, suppression des métadonnées GPS
  used on   S05
SellerRow
  parts     Avatar, nom, étoiles + nombre d'avis, badge vérifié, bouton « Écrire »
  used on   S04, S14
RatingStars
  rule      alternative textuelle « Note 4,8 sur 5, 31 avis » ; étoiles en rating (≥3:1), jamais seules
Avatar, Badge
  Avatar    24, 40, 72px ; initiales si pas de photo (accent-subtle / accent-strong)
  Badge     pastille de notification 10px danger avec bord bg ; compteur à partir de 1
```

## Paiement, remise, confiance (propres au produit)

Ces composants n'existent pas dans l'original sous cette forme : ils répondent aux contraintes de la RDC (mobile money, remise en main propre, confiance).

```
MobileMoneyPicker
  parts     liste radio de 56px : M-Pesa, Orange Money, Airtel Money, Africell (selon l'agrégateur) ; saisie du numéro
  rule      noms en texte, sans logos d'opérateurs (marques déposées : accord requis avant d'utiliser des logos)
  states    choisi (bord accent + bg accent-subtle), indisponible (désactivé avec raison)
  a11y      role="radiogroup", libellé « Moyen de paiement »
  used on   S08, S16
PaymentPending
  parts     indicateur, consigne « Valide le paiement sur ton téléphone », compte à rebours, « Je n'ai rien reçu », annuler
  behaviour polling /orders/{id}/payment ; ne bloque pas la page ; survit à un rechargement ; reprend si le paiement aboutit en retard
  a11y      role="status" (annonce les changements), animation coupée en mouvement réduit
  used on   S08, S09
HandoverCode
  parts     6 cases, version « affichage » (acheteur) et « saisie » (vendeur)
  copy      « Donne ce code au vendeur seulement après avoir vérifié l'article. Il libère l'argent. »
  states    caché par défaut (toucher pour afficher), erreur « Code incorrect, il reste n essais », verrouillé
  a11y      le code est lisible par un lecteur d'écran sur demande, contraste fort
  used on   S09
OrderStepper
  steps     Payé → Remise ou expédition → Argent libéré (et Litige quand il existe)
  states    fait (success-solid + coche), en cours (anneau accent), à venir ; chaque étape a une explication courte
  a11y      <ol> avec aria-label ; l'état courant est dit en texte
  used on   S09, S11
TrustNotice
  parts     Banner « warn » + icône ; texte court
  triggers  message contenant un numéro, un lien de paiement, une demande hors plateforme (messages.flagged)
  copy      « Reste sur la plateforme. Ne paie jamais par un lien ou un numéro reçu en message : tu perds la protection. »
  used on   S07
OfferBubble
  parts     montant, statut (en attente, accepté, refusé, expiré), actions Accepter / Refuser / Contre-proposer pour le vendeur
  used on   S07
DisputeForm
  parts     motif (non reçu, endommagé, non conforme, autre), description, photos de preuve, compte à rebours de la fenêtre de réclamation
  used on   S11
```

## Retours, états, contexte

```
Banner (info, warn, danger, ok)   fond *-bg, texte/icône de la couleur de rôle, titre en gras + texte ; role="note" ou "alert" si urgent
Toast                             fond text, texte bg, action « Annuler » ou fermer ; 4 s par défaut, 8 s s'il y a une action ; role="status"
EmptyState                        icône dans un disque surface, titre, aide, une action ; un message par cause (aucun résultat, aucun message, aucune commande)
ErrorState                        message humain + « Réessayer » ; jamais un code technique seul
Skeleton                          forme de la carte ; animation coupée en mouvement réduit
ConnectivityBanner                « Connexion lente » (photos en basse qualité) et « Hors ligne » (brouillons conservés, envoi à la reconnexion)
DataSaverToggle                   dans Profil et dans le bandeau de connexion lente ; coupe les vidéos, baisse la qualité des images, désactive le chargement automatique
```

## Typographie et argent

- Police : pile système uniquement (`font.sans`), **aucun fichier de police téléchargé**. À tester : rendu des caractères du lingala (ɛ, ɔ) sur Android bas de gamme.
- Échelle : 12/16, 14/20, 16/24, 20/28, 24/30, 32/38, prix 16/20 gras. Prix et compteurs en chiffres tabulaires.
- Argent : USD et CDF. Montants entiers pour le CDF (pas de centimes affichés). Toujours la devise visible, jamais un montant nu.

## Icônes, images, illustrations

- Icônes : jeu ouvert **Lucide** (licence ISC). `preview.html` embarque des tracés compatibles, à remplacer par `lucide-react` dans `/replica-build`.
- Illustrations et photos : **les nôtres** (pas de décalque ni de reprise des visuels de l'original). Direction : photographie locale réelle, fond neutre, personnes de la région.
- Aucun logo d'opérateur de mobile money sans accord écrit.

## Budget de performance (cibles à valider par mesure sur appareil réel)

| Mesure | Cible |
| --- | --- |
| Plus grand affichage (LCP), 4G lente, Android bas de gamme | ≤ 2,5 s |
| JavaScript initial de la page d'accueil | ≤ 150 Ko compressé |
| Image de carte à 320 px de large | ≤ 25 Ko |
| Premier écran du fil (hors JavaScript) | ≤ 500 Ko |
| Police | 0 Ko |

## Ce qui est repris, changé, ajouté

| | Contenu |
| --- | --- |
| **Repris** (modèles d'interaction standard, non appropriables) | barre d'onglets à 5 entrées avec « Vendre » au centre ; grille de fil à 2 colonnes avec prix et cœur ; rangée de puces de filtres ; lignes à chevron avec valeur à droite ; page de filtres avec bouton de résultats fixe ; recherche par rayon avec curseur ; feuille de connexion ; bandeau d'état « Vendu » ; prix avec protection montré en liste |
| **Changé** | couleur d'accent (placeholder neutre, la marque vient de `/replica-brand`) ; rayons (4/8/12 au lieu des leurs) ; icônes (Lucide) ; police (système) ; tous les libellés ; illustrations |
| **Ajouté** | tout le bloc « Paiement, remise, confiance » ; double devise ; PhoneField et OTPInput comme identité ; LandmarkField ; ConnectivityBanner et mode économie de données |
