import { defineNamespace } from "../define";

// Espace de noms « messages » : clés SANS préfixe, clé complète « messages.<clé> ». Voir replica/i18n-brief.md.
export default defineNamespace({
  name: "messages",
  client: true,
  fr: {},
  en: {},
  ln: {},
  sw: {},
});
