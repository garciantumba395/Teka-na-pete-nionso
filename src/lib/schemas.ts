import { z, type ZodType } from "zod";
import { AppError } from "./types";

// Validation SERVEUR de toutes les entrées. Le client valide pour le confort, jamais pour la sécurité.

const uuid = z.string().uuid("Identifiant invalide.");
const phone = z.string().trim().min(5, "Numéro trop court.").max(30, "Numéro trop long.");
const method = z.enum(["mpesa", "orange_money", "airtel_money", "africell_money"], { message: "Moyen de paiement non pris en charge." });
const currency = z.enum(["USD", "CDF"], { message: "Devise non prise en charge." });
const idempotencyKey = z.string().min(8).max(100);

export const otpRequest = z.object({ phone });
export const otpVerify = z.object({
  phone,
  code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres."),
  displayName: z.string().trim().max(60).optional(),
});
export const mePatch = z.object({
  displayName: z.string().trim().max(60).optional(),
  bio: z.string().max(500).optional(),
  areaId: uuid.nullable().optional(),
});
export const itemCreate = z.object({
  title: z.string().max(200),
  description: z.string().max(5000).default(""),
  categoryId: uuid,
  condition: z.string().max(30),
  sizeLabel: z.string().max(40).nullish(),
  brand: z.string().max(80).nullish(),
  priceMinor: z.number({ message: "Indique un prix valide." }).int("Indique un prix valide."),
  currency,
  areaId: uuid.nullish(),
  photos: z.array(z.string().max(600_000)).max(20, "Maximum 20 photos."),
});
export const orderCreate = z.object({
  itemIds: z.array(uuid).min(1, "Choisis au moins un article.").max(20),
  deliveryMethod: z.enum(["hand_delivery", "courier", "relay_point"]).default("hand_delivery"),
  deliveryAreaId: uuid.nullish(),
  deliveryLandmark: z.string().max(200).nullish(),
});
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

/** Identifiant d'URL invalide = ressource introuvable (jamais une erreur serveur). */
export function parseId(raw: string, what = "Ressource"): string {
  const r = idParam.safeParse(raw);
  if (!r.success) throw new AppError("NOT_FOUND", `${what} introuvable.`, 404);
  return r.data;
}
