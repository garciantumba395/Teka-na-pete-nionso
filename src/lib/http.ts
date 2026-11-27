import { NextResponse } from "next/server";
import { AppError, isAppError } from "./types";

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(data, { status, headers });
}

/** Enveloppe commune : erreurs métier -> JSON stable { error: { code, message, details } }. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (isAppError(e)) {
      const headers: Record<string, string> = {};
      if (e.code === "RATE_LIMITED" && e.details?.retryAfter) headers["Retry-After"] = e.details.retryAfter;
      return json({ error: { code: e.code, message: e.message, details: e.code === "RATE_LIMITED" ? undefined : e.details } }, e.status, headers);
    }
    // Jamais de détail interne dans la réponse.
    console.error("[api] erreur inattendue", e);
    return json({ error: { code: "INTERNAL", message: "Une erreur est survenue. Réessaie dans un instant." } }, 500);
  }
}

const MAX_BODY = 15 * 1024 * 1024; // 15 Mo : 20 photos compressées + marge

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) throw new AppError("PAYLOAD_TOO_LARGE", "Les données envoyées sont trop volumineuses.", 413);
  try {
    return (await req.json()) as T;
  } catch {
    throw new AppError("BAD_JSON", "Requête illisible.", 400);
  }
}

export const asString = (v: unknown, max = 5000): string => (typeof v === "string" ? v.slice(0, max) : "");
export const asNumber = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export function num(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
