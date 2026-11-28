import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/copy";
import tokens from "@/styles/tokens.json";

/**
 * Manifeste de l'application installable. Les couleurs viennent des jetons (src/styles/tokens.json) : rien n'est dupliqué ici.
 * Les icônes sont générées par `npm run gen:icons` (scripts/gen-icons.ts), jamais copiées d'ailleurs.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Achète et vends des articles de seconde main près de chez toi, avec paiement protégé.",
    lang: "fr",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: tokens.color.bg,
    theme_color: tokens.color.bg, // identique au <meta name="theme-color"> de la page (voir layout.tsx)
    categories: ["shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
