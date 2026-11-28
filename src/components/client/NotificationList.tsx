"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";
import { useHydrated } from "./useHydrated";

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  /** Date déjà formatée par le serveur (fuseau Africa/Kinshasa) : le rendu serveur et le rendu client sont identiques. */
  dateLabel: string;
}

export function NotificationList({ rows, unreadCount }: { rows: NotificationRow[]; unreadCount: number }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function markRead(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/notifications/${id}/read`, { method: "POST" });
      setStatus("Notification marquée comme lue.");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
    } finally {
      setBusy(null);
    }
  }

  async function markAll() {
    setBusy("all");
    setError(null);
    try {
      await api("/notifications/read-all", { method: "POST" });
      setStatus("Toutes les notifications sont marquées comme lues.");
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Erreur inattendue.");
    } finally {
      setBusy(null);
    }
  }

  /** Ouvrir l'objet concerné vaut lecture : on la valide AVANT de naviguer, pour que la pastille de la page suivante soit juste. */
  async function open(e: React.MouseEvent<HTMLAnchorElement>, row: NotificationRow) {
    if (row.read || !row.href || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    try {
      await api(`/notifications/${row.id}/read`, { method: "POST" });
    } catch {
      // Sans importance : l'utilisateur arrive quand même sur l'objet, la notification reste simplement non lue.
    }
    router.push(row.href);
  }

  return (
    <div className="stack">
      <div className="notif-actions">
        <p className="muted" style={{ margin: 0 }} aria-live="polite">
          {unreadCount > 0 ? `${unreadCount} non lue${unreadCount > 1 ? "s" : ""}` : "Tout est lu"}
        </p>
        <button className="btn btn-secondary" type="button" disabled={unreadCount === 0 || busy !== null || !hydrated} aria-busy={busy === "all" || undefined} onClick={markAll}>
          Tout marquer comme lu
        </button>
      </div>
      {error && <span className="error" role="alert">{error}</span>}
      <p className="sr-only" role="status">{status}</p>
      <ul className="notif-list" aria-label="Notifications">
        {rows.map((r) => (
          <li key={r.id} className="notif" data-unread={!r.read}>
            {r.href ? (
              <Link href={r.href} className="notif-main" onClick={(e) => open(e, r)}>
                <Content row={r} />
              </Link>
            ) : (
              <div className="notif-main"><Content row={r} /></div>
            )}
            {!r.read && (
              <button className="btn btn-ghost" type="button" disabled={busy !== null || !hydrated} onClick={() => markRead(r.id)} aria-label={`Marquer comme lue : ${r.title}`}>
                Marquer comme lue
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Content({ row }: { row: NotificationRow }) {
  return (
    <>
      <span className="notif-title">
        <strong>{row.title}</strong>
        {!row.read && <span className="notif-new">Nouveau</span>}
      </span>
      <span className="notif-body">{row.body}</span>
      <span className="hint">{row.dateLabel}</span>
    </>
  );
}
