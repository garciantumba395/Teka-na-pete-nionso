import { APP_NAME } from "@/lib/copy";
import tokens from "@/styles/tokens.json";

// Page affichée par le service worker quand le réseau est coupé. C'est un document AUTONOME (styles et script en ligne,
// couleurs lues dans les jetons) : il ne dépend d'aucun fichier hashé de Next, donc il reste valable d'un déploiement à l'autre
// et s'affiche même si rien d'autre n'est en cache. Aucune donnée de membre n'y figure : il peut être mis en cache sans risque.
export const dynamic = "force-static";

const c = tokens.color;
const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${c.bg}">
<meta name="robots" content="noindex">
<title>Pas de connexion · ${APP_NAME}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:${c.bg};color:${c.text};font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{max-width:28rem;text-align:center}
  .art{width:72px;height:72px;margin:0 auto 16px;border-radius:50%;background:${c["accent-subtle"]};color:${c["accent-strong"]};display:grid;place-items:center}
  h1{margin:0 0 8px;font-size:1.375rem;line-height:1.3}
  p{margin:0 0 16px;color:${c["text-muted"]}}
  button{min-height:48px;padding:0 24px;border:0;border-radius:999px;background:${c.accent};color:${c["on-accent"]};font:inherit;font-weight:600;cursor:pointer}
  button:focus-visible{outline:3px solid ${c["accent-strong"]};outline-offset:3px}
  [role=status]{min-height:1.5em;margin-top:16px;font-size:.875rem}
</style>
</head>
<body>
<main>
  <div class="art" aria-hidden="true">
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.4a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="M3 3l18 18"/></svg>
  </div>
  <h1>Pas de connexion</h1>
  <p>Tu es hors ligne pour le moment. Vérifie ton réseau ou ton forfait, puis réessaie. Tes annonces et tes commandes ne sont pas perdues : elles sont enregistrées sur nos serveurs.</p>
  <button type="button" id="retry">Réessayer</button>
  <div role="status" id="state"></div>
</main>
<script>
  (function () {
    document.documentElement.setAttribute("data-hydrated", "1"); // même repère que le reste du site (tests de bout en bout)
    var state = document.getElementById("state");
    document.getElementById("retry").addEventListener("click", function () {
      if (navigator.onLine === false) { state.textContent = "Toujours hors ligne."; return; }
      state.textContent = "Nouvelle tentative…";
      location.reload();
    });
    window.addEventListener("online", function () { location.reload(); });
  })();
</script>
</body>
</html>
`;

export function GET() {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Toujours revalidée : le service worker en garde sa propre copie, mais le navigateur ne la fige pas.
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
