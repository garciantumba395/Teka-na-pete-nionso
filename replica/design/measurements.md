# Mesures et observations (référence, jamais livré)

Ce fichier consigne ce qui a été mesuré sur les captures de référence. Il contient des valeurs de l'original :
**ne pas copier dans le code** ; `replica-brand/sweep.py` doit être lancé sur le code, pas sur `replica/`.

## Sources

| # | Capture | Archivée | Nature |
| --- | --- | --- | --- |
| 1 | Deux téléphones : écran de prise de photo et fil d'actualité (français) | `replica/screens/ref-01-feed-camera.png` | visuel promotionnel |
| 2 | Visuel de marque : « Discover », recherche, grille, étiquette de remise, « Nearby » | `ref-02-discover-brand.webp` | visuel promotionnel |
| 3 | Capture de fiche de store en français : fil d'actualité, barre d'onglets | `ref-03-feed-fr.png` | fiche de store |
| 4 | Trois écrans : lancement, feuille d'inscription (Facebook, Google, Apple, e-mail), accueil personnalisé | `ref-04-splash-signup-home.webp` | présentation d'application |
| 5 | Trois écrans : accueil par onglets, fiche article « Vendu », liste de catégories | `ref-05-home-detail-categories.webp` | présentation d'application |
| 6 | Planche d'écrans : création d'annonce (catégorie, couleurs, état, prix, taille de colis, lieu de retrait, intérêt pour l'échange), inscription, connexion, marques récentes | **non archivée** (envoyée sans fichier) | planche de conception, version plus ancienne ou maquette |
| 7 | Trois écrans : filtres complets, lieu avec carte et rayon, résultats avec puces | **non archivée** (envoyée sans fichier) | présentation d'application ou maquette |

**Fiabilité** : les captures 6 et 7 peuvent être des maquettes de designers ou des versions anciennes. Elles indiquent des patterns, pas des fonctions garanties de la version actuelle. Les captures 1 à 5 sont plus proches du produit réel mais de dates différentes (on y voit au moins deux générations d'interface).

## Couleurs mesurées (échantillonnage de pixels, grandes zones seulement)

| Rôle | Mesuré | Fiabilité | Notre rôle / décision |
| --- | --- | --- | --- |
| Fond de page | `#fefefe` | haute (2 123 px) | `bg #ffffff` |
| Gris de la barre de recherche | `#f2f2f2` | haute (6 314 px) | `surface #f2f2f2` |
| Gris des pastilles inactives | `#dcdcdc` | moyenne | `border #e3e3e3` |
| Accent de marque (bandeau, logo, onglet actif) | ≈ `#327480` (nouvelle appli), `#00747e` (ancien visuel) | haute (560 à 584 px) | **non repris** : identité visuelle. Placeholder neutre `#2f5bea` |
| Vert du bandeau « Vendu » | `#28865a` | haute (8 892 px) | `success-solid #237a52` (blanc dessus : 5,28:1) |
| Rouge cœur / pastille | ≈ `#ec3c50` / `#ce465a` | faible (3 px) | `danger #c62f2f` |
| Gris des textes secondaires | ≈ `#848484` | moyenne | `text-muted #5a5a5a` |
| Orange du lien sur fond sombre (« Suivant ») | non mesuré | | `warning`, valeurs propres |

**Constat d'accessibilité** : le gris des textes secondaires de l'original (≈ `#848484` sur blanc) donne environ **3,7:1**, sous le seuil AA de 4,5:1 pour du texte courant. Notre `text-muted` à 6,9:1 est volontairement plus sombre. Les textes en turquoise sur blanc seraient également limites. À l'inverse, le gris de bordure de champ mesuré passe l'exigence des composants d'interface (3:1) : notre `border-input` est à 3,69:1.

## Disposition et patterns observés

- **Barre d'onglets** à 5 entrées : Accueil, Chercher, Vendre (cercle avec plus, au centre), Messages, Profil ; pastille rouge de notification sur Messages. Onglet actif coloré, les autres gris.
- **Fil** : grille à 2 colonnes, photo en portrait (environ 3:4), prix en gras sous la photo, cœur et compteur à droite ; ligne vendeur (avatar + pseudo) intercalée. Marque et taille sous le prix. Étiquette « Nearby » et pastille de remise (−50 %) sur certaines photos.
- **Accueil personnalisé** : bandeau coloré d'invitation à renseigner tailles et marques, carrousels horizontaux, « Voir tout », rangées de marques en puces.
- **Prix avec protection** affiché en liste, en couleur d'accent avec une icône bouclier (« 16,45 incl. »).
- **Fiche article** : galerie avec points, pastille cœur + compteur sur la photo, bandeau d'état « Vendu » sous la photo, ligne vendeur (avatar, étoiles, nombre d'avis, bouton « Demander »), titre, taille · état.
- **Recherche** : liste de catégories avec icône et chevron ; page de filtres complète (tri, catégorie, lieu, prix, retrait en personne, taille, marque, état, matière, couleur) ; bouton de résultats fixe en bas avec le nombre ; carte avec rayon réglable ; puces de filtres actives avec compteur.
- **Vente** : prise de photo plein écran (Fermer, flash, retourner, Suivant, déclencheur) puis formulaire en lignes (catégorie, couleurs jusqu'à 2, état, prix, taille de colis, lieu de retrait, intérêt pour l'échange, remise en main propre).
- **Inscription** : feuille modale avec connexion par réseaux sociaux (Facebook, Google, Apple) puis e-mail.
- **Retours système** : bandeau court « frais de livraison ajoutés au paiement » avec fermeture.

Mesures de taille : approximatives (captures à échelles différentes). Hauteurs de barre et de bouton ci-dessus (`size.*`) sont des choix qui respectent les cibles tactiles, à valider sur appareil réel, pas des copies de pixels.

## Implications pour le reste du pack

- **Recherche par rayon et carte** : le schéma d'architecture n'a que `items.area_id`. Un rayon exige des coordonnées sur les annonces (ou le centroïde de la zone) et un calcul de distance. À ajouter avant le jalon M1.
- **Retrait en personne** : confirme que la remise en main propre existe dans l'original (au moins dans ces maquettes) ; elle reste notre mode par défaut en RDC.
- **Connexion sociale** : remplacée par numéro de téléphone + OTP, plus adaptée (identité = numéro, pas de dépendance à un compte Facebook, Google ou Apple).
