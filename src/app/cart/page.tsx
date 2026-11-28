import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CartLots } from "@/components/client/CartLots";
import { AppBar, EmptyState } from "@/components/ui";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Mon panier" };

// ---- agent J : lots (panier d'un même vendeur)
export default async function CartPage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/cart");
  const cart = await getData().getCart(me.id);
  return (
    <div className="narrow">
      <AppBar title="Mon panier" back="/me" />
      <div className="pad stack-lg">
        {cart.lots.length === 0 ? (
          <EmptyState icon="info" title="Ton panier est vide" action={<Link className="btn btn-secondary" href="/">Voir les annonces</Link>}>
            Ajoute plusieurs articles d&apos;un même vendeur pour les commander ensemble : un seul paiement, une seule remise.
          </EmptyState>
        ) : (
          <>
            <p className="hint" style={{ margin: 0 }}>
              {cart.count} article{cart.count > 1 ? "s" : ""}. Un lot regroupe les articles d&apos;un même vendeur, dans une même devise : une commande, un paiement, une remise.
            </p>
            <CartLots lots={cart.lots} />
          </>
        )}
      </div>
    </div>
  );
}
