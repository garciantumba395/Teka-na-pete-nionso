import { defineNamespace } from "../define";

// Espace de noms « prohibited » : clés SANS préfixe, clé complète « prohibited.<clé> ». Voir replica/i18n-brief.md.
export default defineNamespace({
  name: "prohibited",
  client: false,
  fr: {},
  en: {},
  ln: {},
  sw: {},
});
