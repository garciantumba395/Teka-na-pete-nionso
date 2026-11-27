import type { Metadata, Viewport } from "next";
import "@/styles/tokens.css";
import "@/styles/primitives.css";
import "./globals.css";
import { Hydrated } from "@/components/client/Hydrated";
import { InstallBanner } from "@/components/client/InstallBanner";
import { ServiceWorkerRegister } from "@/components/client/ServiceWorkerRegister";
import { MainNav } from "@/components/MainNav";
import { APP_NAME } from "@/lib/copy";
import { getData } from "@/lib/data";
import { currentUser } from "@/lib/session";
import tokens from "@/styles/tokens.json";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Achète et vends des articles de seconde main près de chez toi, avec paiement protégé.",
  // Application installable (voir src/app/manifest.ts) : icône d'écran d'accueil iOS et mode plein écran.
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/icon.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: tokens.color.bg };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const unread = user ? await getData().countUnreadNotifications(user.id) : 0; // agent C : pastille de non-lus, calculée côté serveur
  return (
    <html lang="fr">
      <body>
        <Hydrated />
        <ServiceWorkerRegister />
        <a href="#main" className="skip-link">Aller au contenu</a>
        <div className="shell">
          <MainNav userName={user?.displayName ?? null} unreadNotifications={unread} />
          <InstallBanner />
          <main id="main" tabIndex={-1}>{children}</main>
        </div>
      </body>
    </html>
  );
}
