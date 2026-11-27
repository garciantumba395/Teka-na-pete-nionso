import { cookies } from "next/headers";
import { getData } from "./data";
import { AppError, type User } from "./types";

// Session = jeton aléatoire opaque dans un cookie HttpOnly. Seule son empreinte SHA-256 est stockée en base :
// une fuite de la base ne permet pas de se faire passer pour un membre, et chaque session est révocable
// (déconnexion d'un appareil, « se déconnecter partout », suppression de compte).
// En production le cookie porte le préfixe __Host- : Secure, sans domaine, chemin « / » imposés par le navigateur.
const prod = process.env.NODE_ENV === "production";
export const SESSION_COOKIE = prod ? "__Host-sid" : "sid";

export async function setSession(token: string, expiresAt: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", secure: prod, expires: new Date(expiresAt),
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function currentUser(): Promise<User | null> {
  const token = await currentToken();
  return token ? getData().getSessionUser(token) : null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AppError("UNAUTHENTICATED", "Connecte-toi pour continuer.", 401);
  return u;
}
