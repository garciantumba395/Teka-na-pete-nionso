import type { Page } from "@playwright/test";
import tokens from "../../src/styles/tokens.json";
import { expect, open, scan, test } from "../support";

// Application installable. `next dev` n'enregistre JAMAIS le service worker : ces tests l'activent par `?sw=1` (documenté
// dans ServiceWorkerRegister.tsx), valable pour l'onglet courant seulement.

const pngSize = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20), sig: b.subarray(0, 8).toString("hex") });

async function enableSw(page: Page, url = "/") {
  await open(page, `${url}${url.includes("?") ? "&" : "?"}sw=1`);
  // attendre un service worker ACTIF qui contrôle la page
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((ok) => { navigator.serviceWorker.addEventListener("controllerchange", () => ok(), { once: true }); if (reg.active) setTimeout(ok, 3000); });
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const cachedUrls = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });

test.describe("PWA : application installable", () => {
  test("PW-1 manifeste valide, couleurs issues des jetons, icônes qui répondent 200 aux bonnes dimensions", async ({ request }) => {
    const r = await request.get("/manifest.webmanifest");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/json/);
    const m = await r.json();
    expect(m.lang).toBe("fr");
    expect(m.display).toBe("standalone");
    expect(m.orientation).toBe("portrait");
    expect(m.start_url).toBe("/");
    expect(m.name.length).toBeGreaterThan(0);
    expect(m.short_name.length).toBeGreaterThan(0);
    expect(m.background_color).toBe(tokens.color.bg);
    expect(m.theme_color).toBe(tokens.color.bg);
    const purposes = m.icons.map((i: { purpose?: string; sizes: string }) => `${i.purpose}:${i.sizes}`);
    for (const need of ["any:192x192", "any:512x512", "maskable:512x512"]) expect(purposes).toContain(need);
    for (const icon of m.icons as { src: string; sizes: string; type: string }[]) {
      const res = await request.get(icon.src);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()["content-type"], icon.src).toContain(icon.type);
      if (icon.type === "image/png") {
        const { w, h, sig } = pngSize(await res.body());
        expect(sig).toBe("89504e470d0a1a0a");
        expect(`${w}x${h}`).toBe(icon.sizes);
      }
    }
    expect((await request.get("/icons/apple-touch-icon.png")).status()).toBe(200);
  });

  test("PW-2 les pages déclarent le manifeste, la couleur de thème et l'icône iOS", async ({ page }) => {
    await open(page, "/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", tokens.color.bg);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/);
  });

  test("PW-3 /offline s'affiche : texte français honnête, bouton Réessayer, accessible", async ({ page }) => {
    const r = await open(page, "/offline");
    expect(r?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Pas de connexion" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const grave = (await scan(page)).filter((i) => i.impact === "serious" || i.impact === "critical");
    expect(grave).toEqual([]);
  });

  test("PW-4 /sw.js : type JavaScript, jamais de cache HTTP", async ({ request }) => {
    const r = await request.get("/sw.js");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/javascript/);
    expect(r.headers()["cache-control"]).toMatch(/no-cache|no-store/);
    expect(r.headers()["cache-control"]).not.toMatch(/max-age=[1-9]/);
    expect(r.headers()["service-worker-allowed"]).toBe("/");
    expect(await r.text()).toContain('startsWith("/api/")');
  });

  test("PW-5 par défaut (développement), aucun service worker n'est enregistré", async ({ page }) => {
    await open(page, "/");
    await page.waitForTimeout(500);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  });

  test("PW-6 avec ?sw=1 : enregistré, pré-cache /offline, ne met JAMAIS /api ni les pages privées en cache", async ({ makeActor }) => {
    const a = await makeActor("Membre PWA");
    const p = a.page;
    await enableSw(p);
    expect(await p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(1);
    expect(await p.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toMatch(/\/$/);
    // trafic de l'API depuis la page et navigations vers des pages privées
    await p.evaluate(async () => { await fetch("/api/v1/categories"); await fetch("/api/v1/me"); });
    await open(p, "/wallet");
    await open(p, "/inbox");
    await open(p, "/me");
    const urls = await cachedUrls(p);
    expect(urls).toContain("/offline");
    expect(urls.some((u) => u.startsWith("/api/")), "aucune réponse /api en cache").toBe(false);
    for (const priv of ["/wallet", "/inbox", "/me", "/orders", "/sell", "/staff"]) expect(urls.some((u) => u === priv || u.startsWith(`${priv}/`)), `${priv} jamais en cache`).toBe(false);
    expect(urls.some((u) => u === "/"), "aucune page HTML en cache").toBe(false);
    // les fichiers statiques versionnés, eux, sont mis en cache pour les visites suivantes
    await expect.poll(async () => (await cachedUrls(p)).some((u) => u.startsWith("/_next/static/"))).toBe(true);
  });

  test("PW-7 hors ligne après une première visite : une navigation affiche la page hors ligne ; Réessayer revient quand le réseau revient", async ({ makeActor }) => {
    test.setTimeout(90_000);
    const a = await makeActor("Membre hors ligne");
    const p = a.page;
    await enableSw(p);
    await a.context.setOffline(true);
    await p.goto("/search", { waitUntil: "domcontentloaded" });
    await expect(p.getByRole("heading", { level: 1, name: "Pas de connexion" })).toBeVisible();
    await expect(p.getByRole("button", { name: "Réessayer" })).toBeVisible();
    await p.getByRole("button", { name: "Réessayer" }).click();
    await expect(p.getByRole("heading", { level: 1, name: "Pas de connexion" })).toBeVisible();
    // le réseau revient : l'événement « online » recharge la page demandée
    await a.context.setOffline(false);
    // (l'émulation de réseau de Playwright peut ne pas rejouer l'événement « online » : on clique aussi sur Réessayer tant que la page hors ligne est là)
    const retry = p.getByRole("button", { name: "Réessayer" });
    await expect(async () => {
      if (await retry.count()) await retry.click({ timeout: 2000 }).catch(() => undefined);
      await expect(p.getByRole("heading", { level: 1, name: "Pas de connexion" })).toHaveCount(0, { timeout: 4000 });
    }).toPass({ timeout: 60_000 });
    await expect(p).toHaveURL(/\/search/);
  });

  test("PW-8 une requête /api hors ligne échoue franchement (aucune réponse inventée par le cache)", async ({ makeActor }) => {
    const a = await makeActor("Membre API");
    const p = a.page;
    await enableSw(p);
    await p.evaluate(() => fetch("/api/v1/categories").then((r) => r.json()));
    await a.context.setOffline(true);
    const outcome = await p.evaluate(() => fetch("/api/v1/categories").then(() => "réponse", () => "échec"));
    expect(outcome).toBe("échec");
    await a.context.setOffline(false);
  });

  test("PW-9 invitation à installer : apparaît avec l'événement du navigateur, se ferme, reste fermée au rechargement", async ({ page }) => {
    await open(page, "/");
    await expect(page.getByRole("region", { name: "Installer l'application" })).toHaveCount(0);
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      e.prompt = () => Promise.resolve();
      e.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(e);
    });
    const banner = page.getByRole("region", { name: "Installer l'application" });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Installer", exact: true })).toBeVisible();
    const grave = (await scan(page)).filter((i) => i.impact === "serious" || i.impact === "critical");
    expect(grave).toEqual([]);
    // jamais bloquant : le contenu reste utilisable derrière
    await expect(page.getByRole("link", { name: "Aller au contenu" })).toHaveCount(1);
    await banner.getByRole("button", { name: /Fermer/ }).click();
    await expect(banner).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("install-banner-dismissed"))).not.toBeNull();
    await open(page, "/");
    await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
    await page.waitForTimeout(300);
    await expect(page.getByRole("region", { name: "Installer l'application" })).toHaveCount(0);
  });

  test("PW-10 clic sur Installer : ouvre l'invitation du navigateur puis referme le bandeau", async ({ page }) => {
    await open(page, "/");
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      (window as unknown as { __prompted: number }).__prompted = 0;
      e.prompt = () => { (window as unknown as { __prompted: number }).__prompted++; return Promise.resolve(); };
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(e);
    });
    await page.getByRole("button", { name: "Installer", exact: true }).click();
    await expect(page.getByRole("region", { name: "Installer l'application" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
  });

  test("PW-11 déjà installée (mode autonome) : aucune invitation", async ({ page }) => {
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => (q.includes("display-mode: standalone") ? ({ ...orig(q), matches: true } as MediaQueryList) : orig(q));
    });
    await open(page, "/");
    await page.evaluate(() => window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true })));
    await page.waitForTimeout(300);
    await expect(page.getByRole("region", { name: "Installer l'application" })).toHaveCount(0);
  });

  test("PW-12 sur iPhone : explication « Ajouter à l'écran d'accueil », sans événement du navigateur, refermable", async ({ browser }) => {
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      viewport: { width: 390, height: 844 }, locale: "fr-FR", baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    });
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
    page.on("pageerror", (e) => problems.push(String(e)));
    await open(page, "/");
    const banner = page.getByRole("region", { name: "Installer l'application" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Ajouter à l'écran d'accueil");
    await expect(banner.getByRole("button", { name: "Installer", exact: true })).toHaveCount(0);
    await banner.getByRole("button", { name: /Fermer/ }).click();
    await expect(banner).toHaveCount(0);
    expect(problems, "aucune erreur d'hydratation ni de console").toEqual([]);
    await ctx.close();
  });
});
