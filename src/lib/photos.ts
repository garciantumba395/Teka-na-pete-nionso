// Règles communes aux photos reçues par le serveur (annonces, messages, preuves de litige).
// Le type est déduit du CONTENU, jamais de ce que le client annonce ; la taille est bornée avant tout stockage.

export type PhotoMime = "image/jpeg" | "image/png" | "image/webp";

/** Taille maximale de la photo reçue en data URL (caractères) : le client la compresse sous 550 000. */
export const PHOTO_MAX_CHARS = 600_000;
/** Taille maximale de la photo décodée (octets). */
export const PHOTO_MAX_BYTES = 450_000;
/** Photos de preuve : au plus 6 par litige et par membre (l'assistance compte comme un membre). */
export const MAX_EVIDENCE_PER_MEMBER = 6;

export function detectMime(b: Buffer): PhotoMime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 4).toString("hex") === "89504e47") return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** Décode une data URL d'image. null si le format, le contenu réel ou la taille ne conviennent pas. */
export function decodePhotoDataUrl(p: unknown): { bytes: Buffer; mime: PhotoMime } | null {
  if (typeof p !== "string" || p.length > PHOTO_MAX_CHARS) return null;
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(p);
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  const mime = detectMime(bytes);
  if (!mime || bytes.length > PHOTO_MAX_BYTES) return null;
  return { bytes, mime };
}

/** Adresse de service d'une photo privée (message ou preuve) : réservée à ses participants. */
export const privatePhotoUrl = (id: string) => `/api/v1/private-photos/${id}`;

export const PHOTO_INVALID_MESSAGE = "Photo invalide ou trop lourde (JPEG, PNG ou WebP, compressée).";
