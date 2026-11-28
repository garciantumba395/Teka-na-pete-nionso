import { defineNamespace } from "../define";

// Espace de noms « common » : mots et messages réutilisés partout. Clé complète « common.<clé> ».
// ln et sw : bêta, à relire par des locuteurs natifs.
export default defineNamespace({
  name: "common",
  client: true,
  fr: {
    language: "Langue",
    beta: "bêta",
    back: "Retour",
    cancel: "Annuler",
    send: "Envoyer",
    close: "Fermer",
    retry: "Réessayer",
    error_generic: "Une erreur est survenue. Réessaie dans un instant.",
    error_network: "Connexion impossible. Vérifie ton réseau puis réessaie.",
  },
  en: {
    language: "Language",
    beta: "beta",
    back: "Back",
    cancel: "Cancel",
    send: "Send",
    close: "Close",
    retry: "Try again",
    error_generic: "Something went wrong. Please try again in a moment.",
    error_network: "Can't connect. Check your network and try again.",
  },
  ln: {
    language: "Lokota",
    beta: "bêta",
    back: "Zonga",
    cancel: "Tika",
    send: "Tinda",
    close: "Kanga",
    retry: "Meka lisusu",
    error_generic: "Likambo ebimi. Meka lisusu sima na mwa ntango.",
    error_network: "Tokoki kokangana te. Tala réseau na yo mpe meka lisusu.",
  },
  sw: {
    language: "Lugha",
    beta: "beta",
    back: "Rudi",
    cancel: "Ghairi",
    send: "Tuma",
    close: "Funga",
    retry: "Jaribu tena",
    error_generic: "Kuna hitilafu. Tafadhali jaribu tena baada ya muda mfupi.",
    error_network: "Hatuwezi kuunganisha. Angalia mtandao wako kisha ujaribu tena.",
  },
});
