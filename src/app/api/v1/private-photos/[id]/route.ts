import { getData } from "@/lib/data";
import { handle } from "@/lib/http";
import { parseIdOrNull } from "@/lib/schemas";
import { requireUser } from "@/lib/session";

// Sert une photo de message ou de preuve de litige. Contrairement aux photos d'annonces (publiques), elle n'est lisible
// que par les participants : session obligatoire (401 sans cookie), puis 404 identique pour « n'existe pas » et « pas pour toi ».
// Le cache est privé au navigateur du membre : jamais de cache partagé (proxy, CDN).
const NOT_FOUND_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const me = await requireUser();
    const id = parseIdOrNull((await params).id);
    const photo = id ? await getData().getPrivatePhoto(id, me.id) : null;
    if (!photo) return new Response("Photo introuvable", { status: 404, headers: NOT_FOUND_HEADERS });
    return new Response(new Uint8Array(photo.bytes), {
      headers: {
        "Content-Type": photo.mime,
        "Content-Length": String(photo.bytes.length),
        "Cache-Control": "private, max-age=3600",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "Content-Disposition": "inline",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  });
}
