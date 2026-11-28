"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, APP_NAME } from "@/lib/copy";
import { useI18n } from "@/i18n/client";
import { LanguageSwitcher } from "./client/LanguageSwitcher";
import { Icon } from "./icons";

const NAV_KEY: Record<string, string> = { "/": "shell.nav_home", "/search": "shell.nav_search", "/sell": "shell.nav_sell", "/inbox": "shell.nav_messages", "/me": "shell.nav_profile" };

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/me") return pathname.startsWith("/me") || pathname.startsWith("/notifications") || pathname.startsWith("/orders") || pathname.startsWith("/wallet") || pathname.startsWith("/members");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Mobile : barre d'onglets fixe en bas. ≥768 px : barre de navigation en haut (même liens, même ordre). */
export function MainNav({ userName, unreadNotifications = 0 }: { userName: string | null; unreadNotifications?: number }) {
  const pathname = usePathname();
  const { t } = useI18n();
  // Le compteur vient du serveur (page racine) : aucune valeur ne dépend de l'heure ou du navigateur, donc pas d'écart d'hydratation.
  const unread = Math.max(0, Math.floor(unreadNotifications));
  const dot = unread > 0 ? <span className="pastille" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null;
  const spoken = unread > 0 ? <span className="sr-only">{t("shell.unread", { count: unread })}</span> : null;
  return (
    <>
      <header className="topnav">
        <Link href="/" className="brand">{APP_NAME}</Link>
        <nav aria-label={t("shell.nav_label")} className="topnav-links">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
              {t(NAV_KEY[n.href] ?? n.href)}
            </Link>
          ))}
          {userName && (
            <Link href="/notifications" aria-current={isActive(pathname, "/notifications") ? "page" : undefined}>
              {t("shell.notifications")}{dot}{spoken}
            </Link>
          )}
        </nav>
        <span className="topnav-end">
          <LanguageSwitcher compact />
          <span className="muted">{userName ? userName : <Link href="/signin">{t("shell.signin")}</Link>}</span>
        </span>
      </header>
      <nav className="tabbar tabbar-fixed" aria-label={t("shell.nav_label_mobile")}>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
            <span className="tab-icon"><Icon name={n.icon} />{n.href === "/me" ? dot : null}</span>
            {t(NAV_KEY[n.href] ?? n.href)}{n.href === "/me" ? spoken : null}
          </Link>
        ))}
      </nav>
    </>
  );
}
