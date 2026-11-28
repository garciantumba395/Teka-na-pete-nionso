import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FollowEditor } from "@/components/client/FollowEditor";
import { AppBar } from "@/components/ui";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Mes préférences" };

// Marques et tailles suivies : elles alimentent la section « Pour toi » de l'accueil.
export default async function PreferencesPage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/me/preferences");
  const follows = await getData().getFollows(me.id);
  return (
    <div className="narrow">
      <AppBar title="Mes préférences" back="/me" />
      <div className="pad stack-lg">
        <p className="muted" style={{ margin: 0 }}>
          Suis des marques et des tailles : l&apos;accueil te montre alors, dans « Pour toi », les annonces récentes qui leur correspondent (jamais les tiennes).
        </p>
        <section aria-labelledby="brands" className="stack">
          <h2 id="brands" className="h2">Marques suivies</h2>
          <FollowEditor kind="brand" initial={follows.brands} />
        </section>
        <section aria-labelledby="sizes" className="stack">
          <h2 id="sizes" className="h2">Tailles suivies</h2>
          <FollowEditor kind="size" initial={follows.sizes} />
        </section>
      </div>
    </div>
  );
}
