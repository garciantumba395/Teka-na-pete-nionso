import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// Le code de remise est DÉRIVÉ de l'identifiant de commande par HMAC avec un secret serveur :
// l'acheteur peut le revoir à tout moment, sans jamais qu'il soit stocké en clair.
// La base ne garde que son empreinte (shipments.handover_code_hash), pour audit.

const SECRET = process.env.HANDOVER_SECRET ?? "dev-only-handover-secret-change-me";

export function deriveHandoverCode(orderId: string, secret: string = SECRET): string {
  const mac = createHmac("sha256", secret).update(`handover:${orderId}`).digest();
  const n = mac.readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function codesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Garde de force brute : 5 essais, puis verrouillage temporaire. */
export interface AttemptState {
  attempts: number;
  lockedUntil: number | null;
}

export function checkAttempt(
  state: AttemptState,
  ok: boolean,
  now: number,
  max: number,
  lockMs: number,
): { state: AttemptState; result: "ok" | "wrong" | "locked" } {
  if (state.lockedUntil && state.lockedUntil > now) return { state, result: "locked" };
  const base = state.lockedUntil && state.lockedUntil <= now ? { attempts: 0, lockedUntil: null } : state;
  if (ok) return { state: { attempts: 0, lockedUntil: null }, result: "ok" };
  const attempts = base.attempts + 1;
  return {
    state: { attempts, lockedUntil: attempts >= max ? now + lockMs : null },
    result: attempts >= max ? "locked" : "wrong",
  };
}
