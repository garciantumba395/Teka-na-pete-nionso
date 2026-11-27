import { ERROR_FALLBACK, NETWORK_ERROR } from "@/lib/copy";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, string>,
    public status = 0,
  ) {
    super(message);
  }
}

/** Appel de l'API interne. Erreurs réseau et erreurs métier ressortent avec un message lisible. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("NETWORK", NETWORK_ERROR);
  }
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, string> } } | null;
  // Session expirée en cours de route : retour à la connexion, puis retour à la page courante.
  if (res.status === 401 && data?.error?.code === "UNAUTHENTICATED" && typeof window !== "undefined" && !path.startsWith("/auth/") && !window.location.pathname.startsWith("/signin")) {
    window.location.assign(`/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  if (!res.ok) throw new ApiError(data?.error?.code ?? "ERROR", data?.error?.message ?? ERROR_FALLBACK, data?.error?.details, res.status);
  return data as T;
}

export const newKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Ne garde qu'un chemin relatif du site : évite qu'un lien ?next= renvoie vers un autre domaine. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
