// Exécuté UNE fois au démarrage du serveur Next.js : en production, une configuration de développement
// (secrets par défaut, paiement factice, SMS console, couche en mémoire) empêche le démarrage.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { assertProductionConfig } = await import("./lib/config");
    assertProductionConfig();
  }
}
