import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import { SHIPMENT_EVENT_LABEL } from "@/lib/copy-courier";
import { formatDateTimeShort } from "@/lib/datetime";
import type { DeliveryMethod, ItemCard, OrderStatus, ShipmentView } from "@/lib/types";
import { Icon, type IconName } from "./icons";

// Primitives présentationnelles (sans état). Mêmes classes que replica/design/primitives.css.

export function AppBar({ title, back, children }: { title: string; back?: string; children?: ReactNode }) {
  return (
    <div className="appbar">
      {back ? (
        <Link href={back} className="iconbtn" aria-label="Retour">
          <Icon name="back" />
        </Link>
      ) : (
        <span style={{ width: "var(--size-touch-min)" }} aria-hidden="true" />
      )}
      <h1 style={{ margin: 0, font: "var(--text-lg-weight) var(--text-lg-size)/var(--text-lg-line) var(--font-sans)" }}>{title}</h1>
      <span style={{ minWidth: "var(--size-touch-min)", display: "inline-flex", justifyContent: "flex-end" }}>{children}</span>
    </div>
  );
}

export function Banner({ kind = "info", title, children, role }: { kind?: "info" | "warn" | "danger" | "ok"; title?: string; children?: ReactNode; role?: "alert" | "status" | "note" }) {
  const icon: IconName = kind === "ok" ? "check" : "info";
  return (
    <div className={`banner ${kind}`} role={role ?? (kind === "danger" ? "alert" : "note")}>
      <Icon name={icon} />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon = "search", title, children, action, heading = false }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode; heading?: boolean }) {
  return (
    <div className="empty">
      <div className="art">
        <Icon name={icon} size={40} />
      </div>
      {heading ? <h1 style={{ font: "inherit", fontWeight: 700, margin: 0 }}>{title}</h1> : <strong>{title}</strong>}
      {children ? <span className="muted">{children}</span> : null}
      {action}
    </div>
  );
}

export function Avatar({ name, size }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return (
    <div className="avatar" aria-hidden="true" style={size ? { width: size, height: size } : undefined}>
      {initials || "?"}
    </div>
  );
}

export function Stars({ value, count }: { value: number | null; count: number }) {
  if (value === null || count === 0) return <span className="muted" style={{ fontSize: "var(--text-sm-size)" }}>Pas encore d&apos;avis</span>;
  const full = Math.round(value);
  return (
    <span className="stars" role="img" aria-label={`Note ${String(value).replace(".", ",")} sur 5, ${count} avis`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} className="icon" viewBox="0 0 24 24" aria-hidden="true" style={{ opacity: i <= full ? 1 : 0.25 }}>
          <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
        </svg>
      ))}
      <span className="n">({count})</span>
    </span>
  );
}

export function PriceTag({ item, large = false }: { item: Pick<ItemCard, "priceMinor" | "currency" | "protectedPriceMinor">; large?: boolean }) {
  const showProtected = item.protectedPriceMinor > item.priceMinor;
  return (
    <span style={{ display: "grid", gap: 2 }}>
      <span className="price" style={large ? { fontSize: 24, lineHeight: "30px" } : undefined}>{formatMoney(item.priceMinor, item.currency)}</span>
      {showProtected ? (
        <span className="price-incl">
          <Icon name="shield" />
          {formatMoney(item.protectedPriceMinor, item.currency)} avec protection
        </span>
      ) : null}
    </span>
  );
}

export function ListingCard({ item, showDistance = false }: { item: ItemCard; showDistance?: boolean }) {
  const unavailable = item.status === "sold" || item.status === "reserved";
  return (
    <Link href={`/items/${item.id}`} className="card">
      <div className="media">
        {item.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photo} alt="" width={300} height={400} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div className="ph" />
        )}
        {item.areaName ? <span className="tagline">{item.areaName}</span> : null}
        {item.status === "sold" ? <span className="sold">Vendu</span> : item.status === "reserved" ? <span className="sold" style={{ background: "var(--color-warning)" }}>Réservé</span> : null}
      </div>
      <PriceTag item={item} />
      <span className="meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
      <span className="meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {showDistance && item.distanceKm !== null ? `${String(item.distanceKm).replace(".", ",")} km · ` : ""}
        {item.meta}
      </span>
    </Link>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="card" key={i} aria-hidden="true">
          <div className="media skeleton" />
          <span className="skeleton" style={{ height: 20, width: "55%" }} />
          <span className="skeleton" style={{ height: 14, width: "85%" }} />
        </div>
      ))}
    </div>
  );
}

const STEPS: { key: string; title: string; hint: string }[] = [
  { key: "paid", title: "Payé", hint: "L'argent est mis de côté, le vendeur ne le reçoit pas encore." },
  { key: "handover", title: "Remise en main propre", hint: "Rendez-vous convenu, avec vérification de l'article." },
  { key: "released", title: "Argent libéré au vendeur", hint: "Dès que le code de remise est validé." },
];

// ---- agent D : frise de la livraison par coursier
const COURIER_STEPS: { key: string; title: string; hint: string }[] = [
  { key: "paid", title: "Payé", hint: "L'argent est mis de côté, le vendeur ne le reçoit pas encore." },
  { key: "handed", title: "Remis au coursier", hint: "Le vendeur confie le colis à un coursier." },
  { key: "transit", title: "En route", hint: "Le coursier apporte le colis à l'adresse indiquée." },
  { key: "received", title: "Reçu", hint: "L'acheteur confirme avoir reçu le colis." },
  { key: "released", title: "Argent libéré au vendeur", hint: "Quand l'acheteur accepte, ou automatiquement à la fin du délai de réclamation sans litige." },
];

/** Nombre d'étapes terminées de la frise « coursier », déduit du statut de la commande et de l'historique du colis. */
function courierDoneCount(status: OrderStatus, shipment: ShipmentView | null | undefined): number {
  if (status === "completed") return COURIER_STEPS.length;
  if (status === "delivered") return 4;
  const seen = (k: string) => !!shipment?.events.some((e) => e.kind === k);
  if (status === "disputed") return seen("received") ? 4 : seen("in_transit") ? 3 : seen("handed_to_courier") ? 2 : 1;
  if (status === "in_delivery") return shipment?.status === "in_transit" ? 3 : 2;
  return status === "paid" ? 1 : 0;
}

export function OrderStepper({ status, method, shipment }: { status: OrderStatus; method?: DeliveryMethod; shipment?: ShipmentView | null }) {
  const courier = method === "courier";
  const steps = courier ? COURIER_STEPS : STEPS;
  const doneCount = courier
    ? courierDoneCount(status, shipment)
    : status === "completed" ? 3 : status === "paid" || status === "in_delivery" || status === "delivered" ? 1 : 0;
  const terminalBad = status === "cancelled" || status === "expired" || status === "refunded";
  return (
    <ol className="steps" aria-label="Suivi de la commande">
      {steps.map((s, i) => {
        const state = terminalBad ? "todo" : i < doneCount ? "done" : i === doneCount ? "current" : "todo";
        return (
          <li key={s.key} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="dot">{state === "done" ? <Icon name="check" /> : null}</span>
            <div>
              <strong>{s.title}</strong>
              <small>{s.hint}</small>
              <span className="sr-only">{state === "done" ? "Étape terminée" : state === "current" ? "Étape en cours" : "Étape à venir"}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Historique horodaté d'une livraison par coursier (heures de Kinshasa). */
export function ShipmentTimeline({ shipment }: { shipment: ShipmentView }) {
  if (shipment.events.length === 0) return null;
  return (
    <section className="stack" aria-labelledby="history">
      <h2 id="history" className="h2">Historique</h2>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "var(--space-8)" }}>
        {shipment.events.map((e) => (
          <li key={e.id} style={{ display: "flex", gap: "var(--space-12)", justifyContent: "space-between", alignItems: "baseline" }}>
            <span>{SHIPMENT_EVENT_LABEL[e.kind] ?? e.kind}</span>
            <span className="hint tnum" style={{ whiteSpace: "nowrap" }}>{formatDateTimeShort(e.at)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Écran dont le jalon n'est pas encore construit. Route réelle, état vide honnête. */
export function StubScreen({ id, title, milestone, children }: { id: string; title: string; milestone: string; children?: ReactNode }) {
  return (
    <div className="narrow">
      <AppBar title={title} back="/" />
      <div className="pad">
        <EmptyState icon="info" title="Bientôt disponible" action={<Link className="btn btn-secondary" href="/">Retour à l&apos;accueil</Link>}>
          Cet écran ({id}) est prévu au jalon {milestone}. {children}
        </EmptyState>
      </div>
    </div>
  );
}
