import { defineConfig } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";

// Les tests tournent contre un serveur de développement lancé par scripts/e2e-server.sh (couche factice ou PostgreSQL).
// `npm start` (production) refuse volontairement les fournisseurs factices.
export default defineConfig({
  testDir: "e2e/specs",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  retries: 0, // un test instable doit se voir, pas se cacher
  reporter: [["list"], ["json", { outputFile: "test-results/report.json" }]],
  outputDir: "test-results/artifacts",
  use: {
    baseURL: BASE,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    locale: "fr-FR",
    timezoneId: "Africa/Kinshasa",
  },
  projects: [
    { name: "mobile", use: { viewport: { width: 390, height: 844 } }, testIgnore: /\.desktop\.spec\.ts/ },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } }, testMatch: /\.desktop\.spec\.ts/ },
  ],
});
