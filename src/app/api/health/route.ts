import { getData } from "@/lib/data";

// Point de contrôle pour la supervision et l'équilibreur de charge. Teste réellement la base.
// Aucun détail dans la réponse (la configuration manquante est dans les journaux du serveur, pas chez le visiteur).
export async function GET() {
  try {
    await getData().health();
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[health] indisponible :", (e as Error).message);
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
