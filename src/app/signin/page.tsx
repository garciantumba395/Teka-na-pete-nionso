import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/client/SignInForm";
import { safeNext } from "@/components/client/api";
import { AppBar } from "@/components/ui";
import { APP_NAME } from "@/lib/copy";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Connexion" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  if (await currentUser()) redirect(target);
  return (
    <div className="narrow">
      <AppBar title="Connexion" back="/" />
      <div className="pad stack-lg">
        <p style={{ margin: 0 }}>
          Bienvenue sur {APP_NAME}. Ton numéro de téléphone sert à te connecter : pas de mot de passe à retenir.
        </p>
        <SignInForm next={target} />
      </div>
    </div>
  );
}
