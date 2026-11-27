import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BuyButton } from "@/components/client/BuyButton";
import { StartChatButton } from "@/components/client/StartChatButton";
import { Icon } from "@/components/icons";
import { AppBar, Avatar, Banner, PriceTag, Stars } from "@/components/ui";
import { getData } from "@/lib/data";
import { formatMoney } from "@/lib/money";
import { currentUser } from "@/lib/session";
import { CONDITIONS } from "@/lib/validation";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const item = await getData().getItem(id, (await currentUser())?.id);
  return { title: item ? item.title : "Annonce introuvable" };
}

export default async function ItemPage({ params }: Props) {
  const { id } = await params;
  const me = await currentUser();
  const item = await getData().getItem(id, me?.id);
  if (!item) notFound();

  const own = me?.id === item.sellerId;
  const available = item.status === "active";
  const condition = CONDITIONS.find((c) => c.value === item.condition)?.label ?? "";
  const facts: [string, string][] = [
    ["État", condition],
    ["Catégorie", item.categoryName],
    ["Marque", item.brand ?? "Non précisée"],
    ["Taille", item.sizeLabel ?? "Non précisée"],
  ];

  return (
    <div style={{ maxWidth: "var(--layout-content-max)", margin: "0 auto" }}>
      <AppBar title="Annonce" back="/" />
      <div className="page">
        <div className="split">
          <div className="stack">
            {item.photos.length > 0 ? (
              <div className="gallery" role="group" aria-roledescription="carrousel" aria-label={`Photos de ${item.title}`} tabIndex={0}>
                {item.photos.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`Photo ${i + 1} sur ${item.photos.length} : ${item.title}`} width={300} height={400} loading={i === 0 ? "eager" : "lazy"} decoding="async" />
                ))}
              </div>
            ) : (
              <div className="empty"><span className="muted">Pas de photo</span></div>
            )}
            {item.photos.length > 1 && <span className="hint">{item.photos.length} photos, fais défiler pour les voir.</span>}
            {item.status === "sold" && <Banner kind="ok" title="Vendu">Cet article a trouvé preneur.</Banner>}
            {item.status === "reserved" && <Banner kind="warn" title="Réservé">Un acheteur est en train de le payer. Reviens dans quelques minutes.</Banner>}
            {own && item.status !== "sold" && <Banner kind="info" title="C'est ton annonce">Tu seras prévenu à l&apos;achat.</Banner>}
          </div>

          <div className="stack-lg">
            <div className="stack">
              <h1 className="h1" style={{ overflowWrap: "anywhere" }}>{item.title}</h1>
              <PriceTag item={item} large />
              {item.protectedPriceMinor > item.priceMinor && (
                <p className="hint" style={{ margin: 0 }}>
                  La protection acheteur ({formatMoney(item.protectedPriceMinor - item.priceMinor, item.currency)}) garde ton argent en sécurité jusqu&apos;à la remise de l&apos;article.
                </p>
              )}
            </div>

            <dl className="kv" aria-label="Détails de l'article">
              {facts.map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
              {item.areaName && <><dt>Lieu</dt><dd><Icon name="pin" size={14} /> {item.areaName}</dd></>}
            </dl>

            {item.description && <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.description}</p>}

            <Link href={`/members/${item.seller.id}`} className="seller row-link" style={{ padding: "var(--space-8) 0", color: "inherit", textDecoration: "none" }}>
              <Avatar name={item.seller.displayName} />
              <div className="who">
                <strong>{item.seller.displayName}</strong>
                <Stars value={item.seller.ratingAvg} count={item.seller.ratingCount} />
              </div>
              <Icon name="chev" />
            </Link>

            <Banner kind="info" title="Remise en main propre">
              Tu paies sur l&apos;appli, tu vérifies l&apos;article, puis tu donnes un code au vendeur. Il ne reçoit l&apos;argent qu&apos;à ce moment-là.
            </Banner>
          </div>
        </div>
      </div>

      {!own && (item.status === "active" || item.status === "reserved") && !available && (
        <div className="cta-bar"><StartChatButton itemId={item.id} className="btn btn-secondary btn-lg" /></div>
      )}
      {available && !own && (
        <div className="cta-bar">
          <StartChatButton itemId={item.id} label="Écrire" />
          <BuyButton itemId={item.id} label={`Acheter · ${formatMoney(item.protectedPriceMinor, item.currency)}`} />
        </div>
      )}
    </div>
  );
}
