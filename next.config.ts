import type { NextConfig } from "next";

const prod = process.env.NODE_ENV === "production";

// CSP : en production seulement (le mode développement de Next utilise eval pour le rechargement à chaud).
// 'unsafe-inline' pour les scripts est le compromis actuel (hydratation de Next) ; une CSP à nonce via un middleware
// est l'amélioration prévue. Les images « data: » servent aux photos de démonstration de la couche factice.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=()" },
          ...(prod
            ? [
                { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
                { key: "Content-Security-Policy", value: CSP },
              ]
            : []),
        ],
      },
    ];
  },
};

export default config;
