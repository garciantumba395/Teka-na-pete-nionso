import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getData } from "./data";
import { AppError, type User } from "./types";

// Session de démonstration : cookie signé (HMAC) contenant l'identifiant du membre.
// /replica-backend la remplace par Supabase Auth (JWT, rotation, révocation).
const SECRET = process.env.SESSION_SECRET ?? "dev-only-session-secret-change-me";
const NAME = "sid";
const MAX_AGE = 60 * 60 * 24 * 30;

const sign = (v: string) => createHmac("sha256", SECRET).update(v).digest("base64url");

export function encodeSession(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function decodeSession(raw: string | undefined): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i < 1) return null;
  const id = raw.slice(0, i);
  const a = Buffer.from(sign(id));
  const b = Buffer.from(raw.slice(i + 1));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export async function setSession(userId: string) {
  (await cookies()).set(NAME, encodeSession(userId), {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: MAX_AGE, secure: process.env.NODE_ENV === "production",
  });
}

export async function clearSession() {
  (await cookies()).delete(NAME);
}

export async function currentUser(): Promise<User | null> {
  const id = decodeSession((await cookies()).get(NAME)?.value);
  return id ? getData().getUser(id) : null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AppError("UNAUTHENTICATED", "Connecte-toi pour continuer.", 401);
  return u;
}
