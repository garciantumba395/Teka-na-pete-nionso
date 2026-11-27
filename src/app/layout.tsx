import type { Metadata, Viewport } from "next";
import "@/styles/tokens.css";
import "@/styles/primitives.css";
import "./globals.css";
import { Hydrated } from "@/components/client/Hydrated";
import { MainNav } from "@/components/MainNav";
import { APP_NAME } from "@/lib/copy";
import { currentUser } from "@/lib/session";
import tokens from "@/styles/tokens.json";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "Achète et vends des articles de seconde main près de chez toi, avec paiement protégé.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: tokens.color.bg };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="fr">
      <body>
        <Hydrated />
        <a href="#main" className="skip-link">Aller au contenu</a>
        <div className="shell">
          <MainNav userName={user?.displayName ?? null} />
          <main id="main" tabIndex={-1}>{children}</main>
        </div>
      </body>
    </html>
  );
}
