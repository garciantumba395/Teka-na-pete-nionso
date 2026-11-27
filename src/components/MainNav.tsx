"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, APP_NAME } from "@/lib/copy";
import { Icon } from "./icons";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/me") return pathname.startsWith("/me") || pathname.startsWith("/orders") || pathname.startsWith("/wallet") || pathname.startsWith("/members");
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Mobile : barre d'onglets fixe en bas. ≥768 px : barre de navigation en haut (même liens, même ordre). */
export function MainNav({ userName }: { userName: string | null }) {
  const pathname = usePathname();
  return (
    <>
      <header className="topnav">
        <Link href="/" className="brand">{APP_NAME}</Link>
        <nav aria-label="Navigation principale" className="topnav-links">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {userName ? userName : <Link href="/signin">Connexion</Link>}
        </span>
      </header>
      <nav className="tabbar tabbar-fixed" aria-label="Navigation principale (mobile)">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
            <Icon name={n.icon} />
            {n.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
