import { createHmac, timingSafeEqual } from "node:crypto";
import type { Currency, PaymentMethod } from "../types";

// Interface PaymentProvider (voir replica/architecture.md). Le métier ne connaît que ceci :
// brancher un vrai agrégateur mobile money = écrire une autre implémentation, sans toucher aux écrans.

export interface CollectionRequest {
  orderId: string;
  paymentId: string;
  amountMinor: number;
  currency: Currency;
  method: PaymentMethod;
  msisdn: string;
  idempotencyKey: string;
}

export interface PayoutRequest {
  payoutId: string;
  amountMinor: number;
  currency: Currency;
  method: PaymentMethod;
  msisdn: string;
  idempotencyKey: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** Demande à l'abonné de valider sur son téléphone. Le résultat final arrive par webhook. */
  initiateCollection(req: CollectionRequest): Promise<{ providerRef: string }>;
  initiatePayout(req: PayoutRequest): Promise<{ providerRef: string }>;
  refund(args: { providerRef: string; amountMinor: number }): Promise<{ ok: boolean }>;
}

const SECRET = process.env.PSP_WEBHOOK_SECRET ?? "dev-only-webhook-secret-change-me";

export function signPayload(rawBody: string, secret: string = SECRET): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(rawBody: string, signature: string | null, secret: string = SECRET): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signPayload(rawBody, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
