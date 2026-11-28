#!/usr/bin/env bash
# Repère les textes français encore écrits en dur dans des fichiers : scripts/i18n-scan.sh <fichier ou dossier> …
# Heuristique : lignes avec des lettres accentuées ou des mots français courants, hors commentaires, imports et lignes de test.
# Une ligne listée n'est pas forcément un défaut (nom propre, commentaire de code) : à juger, mais la liste doit être vide ou expliquée.
set -uo pipefail
[[ $# -eq 0 ]] && { echo "usage: $0 <fichier|dossier> …" >&2; exit 2; }
grep -rnE --include='*.ts' --include='*.tsx' \
  '[àâçéèêëîïôùûüÀÉÈÊ]|\b(Annuler|Retour|Envoyer|Choisis|Réessaie|Aucun|Aucune|Vendu|Voir|Ajouter|Retirer|Publier|Commande|Paiement|Annonce|Connexion|Chercher|Vendre|Bientôt|Erreur|Merci|Oui|Non)\b' "$@" 2>/dev/null \
  | grep -vE ':[0-9]+:\s*(//|\*|/\*|import |export type|type )' \
  | grep -vE '__tests__|\.test\.ts|\.spec\.ts' \
  | grep -vE '^\S+:[0-9]+:.*(console\.(log|error)|throw new AppError|new AppError)' \
  || true
