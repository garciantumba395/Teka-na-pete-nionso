import { z, type ZodType } from "zod";
import { AppError } from "./types";
import { cleanLine, cleanText } from "./text";

// Validation SERVEUR de toutes les entrées. Le client valide pour le confort, jamais pour la sécurité.

const uuid = z.string().uuid("Identifiant invalide.");
const phone = z.string().trim().min(5, "Numéro trop court.").max(30, "Numéro trop long.");
const method = z.enum(["mpesa", "orange_money", "airtel_money", "africell_money"], { message: "Moyen de paiement non pris en charge." });
const currency = z.enum(["USD", "CDF"], { message: "Devise non prise en charge." });
/** Texte libre nettoyé (voir text.ts) puis borné : la longueur compte après nettoyage. */
const line = (max: number) => z.string().transform(cleanLine).pipe(z.string().trim().max(max));
const multiline = (max: number) => z.string().transform(cleanText).pipe(z.string().max(max));
const idempotencyKey = z.string().min(8).max(100);

export const otpRequest = z.object({ phone });
export const otpVerify = z.object({
  phone,
  code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres."),
  displayName: line(60).optional(),
});
export const mePatch = z.object({
  displayName: line(60).optional(),
  bio: multiline(500).optional(),
  areaId: uuid.nullable().optional(),
});
export const itemCreate = z.object({
  // Même borne que la contrainte de la base (3 à 80) : sinon la couche factice accepterait un brouillon que PostgreSQL refuse.
  title: z.string().transform(cleanLine).pipe(z.string().trim().min(3, "Le titre doit faire entre 3 et 80 caractères.").max(80, "Le titre doit faire entre 3 et 80 caractères.")),
  description: multiline(5000).default(""),
  categoryId: uuid,
  condition: z.string().max(30),
  sizeLabel: line(40).nullish(),
  brand: line(80).nullish(),
  priceMinor: z.number({ message: "Indique un prix valide." }).int("Indique un prix valide."),
  currency,
  areaId: uuid.nullish(),
  photos: z.array(z.string().max(600_000)).max(20, "Maximum 20 photos."),
});
export const orderCreate = z.object({
  itemIds: z.array(uuid).min(1, "Choisis au moins un article.").max(20),
  deliveryMethod: z.enum(["hand_delivery", "courier", "relay_point"]).default("hand_delivery"),
  deliveryAreaId: uuid.nullish(),
  deliveryLandmark: line(200).nullish(),
});
export const conversationCreate = z.object({ itemId: uuid });
export const messageCreate = z.object({
  body: z.string().transform(cleanText).pipe(z.string().trim().min(1, "Écris un message.").max(2000, "Un message est limité à 2 000 caractères.")),
});
export const disputeOpen = z.object({
  reason: z.enum(["not_received", "damaged", "not_as_described", "other"], { message: "Choisis le motif du problème." }),
  description: multiline(2000).pipe(z.string().trim().min(10, "Décris le problème en quelques mots (10 caractères au moins).")),
});
export const disputeNote = z.object({ note: z.string().transform(cleanText).pipe(z.string().trim().min(1, "Écris un message.").max(1000, "Un message est limité à 1 000 caractères.")) });
export const disputeResolve = z.object({
  outcome: z.enum(["refund_buyer", "release_seller"], { message: "Choisis une décision." }),
  note: z.string().transform(cleanText).pipe(z.string().trim().max(1000)).optional(),
});
export const reviewCreate = z.object({
  rating: z.number({ message: "Choisis une note de 1 à 5." }).int("Choisis une note de 1 à 5.").min(1, "Choisis une note de 1 à 5.").max(5, "Choisis une note de 1 à 5."),
  comment: z.string().transform(cleanText).pipe(z.string().trim().max(500, "Un avis est limité à 500 caractères.")).default(""),
});
export const reportCreate = z.object({
  targetType: z.enum(["item", "user"], { message: "Cible invalide." }),
  targetId: uuid,
  reason: z.enum(["prohibited", "counterfeit", "scam", "offensive", "harassment", "other"], { message: "Choisis un motif." }),
  details: z.string().transform(cleanText).pipe(z.string().trim().max(1000, "Les précisions sont limitées à 1 000 caractères.")).default(""),
});
export const reportHandle = z.object({ action: z.enum(["dismiss", "hide_item", "suspend_user"], { message: "Action invalide." }) });
export const payOrder = z.object({ method, msisdn: phone, idempotencyKey });
export const confirmDelivery = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres.") });
export const payoutCreate = z.object({
  amountMinor: z.number().int("Indique un montant valide.").positive("Indique un montant valide."),
  currency,
  method,
  msisdn: phone,
  idempotencyKey,
});
export const webhookEvent = z.object({
  eventId: z.string().min(1).max(200),
  type: z.enum(["collection.succeeded", "collection.failed", "payout.succeeded", "payout.failed"]),
  providerRef: z.string().min(1).max(200),
  failureCode: z.string().max(100).optional(),
});
// ---- agent C : notifications
export const notificationPrefsPatch = z.object({
  orders: z.boolean({ message: "Valeur invalide." }).optional(),
  disputes: z.boolean({ message: "Valeur invalide." }).optional(),
}).strict();
// ---- fin agent C : notifications
export const idParam = uuid;

/** Valide une entrée et lève une erreur 422 avec un message par champ. */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const details: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!details[key]) details[key] = issue.message;
  }
  throw new AppError("VALIDATION", Object.values(details)[0] ?? "Requête invalide.", 422, details);
}

/** Identifiant valide ou null (pour décider un 404 sans lever d'erreur). */
export const parseIdOrNull = (raw: string): string | null => { const r = idParam.safeParse(raw); return r.success ? r.data : null; };

/** Identifiant d'URL invalide = ressource introuvable (jamais une erreur serveur). */
export function parseId(raw: string, what = "Ressource"): string {
  const r = idParam.safeParse(raw);
  if (!r.success) throw new AppError("NOT_FOUND", `${what} introuvable.`, 404);
  return r.data;
}
