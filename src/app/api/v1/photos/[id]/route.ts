import { getData } from "@/lib/data";
import { handle } from "@/lib/http";
import { parseId } from "@/lib/schemas";

// Sert une photo stockée en base. Le type vient du contenu détecté à l'envoi, jamais du client.
// Les identifiants sont des UUID aléatoires et le contenu ne change jamais : cache public immuable (économie de données).
// Les en-têtes interdisent toute exécution de contenu actif si le fichier est ouvert directement.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = parseId((await params).id, "Photo");
    const photo = await getData().getPhoto(id);
    if (!photo) return new Response("Photo introuvable", { status: 404 });
    return new Response(new Uint8Array(photo.bytes), {
      headers: {
        "Content-Type": photo.mime,
        "Content-Length": String(photo.bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  });
}
