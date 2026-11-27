// Préparation des photos côté navigateur, partagée par les annonces, les messages et les preuves de litige.

const MAX_EDGE = 1280;
const MAX_CHARS = 550_000; // le serveur refuse au-delà de 600 000 caractères

/**
 * Redessine l'image sur un canvas : réduit la taille (économie de données mobiles) ET supprime toutes les
 * métadonnées, dont la position GPS de la photo (confidentialité du membre). Retourne une data URL JPEG.
 */
export async function compressImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  for (const q of [0.72, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_CHARS) return url;
  }
  throw new Error("trop lourde");
}
