import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { Pool } from "pg";
import { seedId } from "../src/lib/data/ids";

export { expect };

/** Identifiants de référence (identiques en couche factice et en PostgreSQL). */
export const ID = {
  catRobes: seedId("cat-robes"),
  catFemme: seedId("cat-femme"),
  catElectro: seedId("cat-audio"),
  areaGombe: seedId("area-com-gombe"),
  areaLimete: seedId("area-com-limete"),
  userMarie: seedId("user-marie"),
  item02: seedId("item-02"),
};

/** JPEG minimal accepté par les deux couches (type vérifié sur le contenu). */
export const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ";
export const OTP = "123456";
export const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789abcdef";

let seq = 0;
const rnd = (n: number) => Math.floor(Math.random() * n);
/** Adresse unique par test : la limitation de débit par IP ne doit pas faire échouer les tests entre eux. */
export const randomIp = () => `198.51.${rnd(250) + 1}.${rnd(250) + 1}`;
/** Numéro mobile congolais valide et unique. */
export const uniquePhone = () => `082${String(Date.now() % 1e3).padStart(3, "0")}${String(++seq % 100).padStart(2, "0")}${String(rnd(100)).padStart(2, "0")}`;
export const uniqueTitle = (base = "Robe") => `${base} ${Date.now().toString(36)}${++seq}`;

export interface Actor {
  name: string;
  phone: string;
  userId: string;
  context: BrowserContext;
  page: Page;
  request: APIRequestContext;
}

interface Fixtures {
  ip: string;
  /** Crée un membre connecté (contexte navigateur isolé, IP propre, session ouverte par l'API). */
  makeActor: (name?: string) => Promise<Actor>;
  /** Faux, sauf si le test l'autorise : échoue sur erreur console, exception de page ou réponse 5xx. */
  allowConsoleErrors: { value: boolean };
}

export const test = base.extend<Fixtures>({
  ip: async ({}, use) => use(randomIp()),
  context: async ({ context, ip }, use) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": ip });
    await use(context);
  },
  allowConsoleErrors: async ({}, use) => use({ value: false }),
  makeActor: async ({ browser, allowConsoleErrors }, use) => {
    const made: BrowserContext[] = [];
    const problems: string[] = [];
    await use(async (name = "Testeur") => {
      const actor = await newActor(browser, name, problems);
      made.push(actor.context);
      return actor;
    });
    for (const c of made) await c.close();
    if (!allowConsoleErrors.value) expect(problems, "erreurs console ou réponses 5xx pendant le test").toEqual([]);
  },
  // Garde automatique sur la page principale du test.
  page: async ({ page, allowConsoleErrors }, use) => {
    const problems: string[] = [];
    watch(page, problems);
    await use(page);
    if (!allowConsoleErrors.value) expect(problems, "erreurs console ou réponses 5xx pendant le test").toEqual([]);
  },
});

function watch(page: Page, problems: string[]) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => problems.push(`exception: ${String(e).slice(0, 3500)} @ ${page.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
}

async function newActor(browser: Browser, name: string, problems: string[]): Promise<Actor> {
  const ip = randomIp();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR", timezoneId: "Africa/Kinshasa", extraHTTPHeaders: { "x-forwarded-for": ip }, baseURL: process.env.BASE_URL ?? "http://localhost:3100" });
  const page = await context.newPage();
  watch(page, problems);
  const phone = uniquePhone();
  const user = await signUp(context.request, phone, name);
  return { name, phone, userId: user.id, context, page, request: context.request };
}

// ------------------------------------------------------------------------------------------------- API
export async function signUp(request: APIRequestContext, phone = uniquePhone(), name = "Testeur"): Promise<{ id: string; phone: string }> {
  const a = await request.post("/api/v1/auth/otp", { data: { phone } });
  expect(a.status(), "envoi du code").toBe(200);
  const b = await request.post("/api/v1/auth/otp/verify", { data: { phone, code: OTP, displayName: name } });
  expect(b.status(), "vérification du code").toBe(200);
  return { id: (await b.json()).user.id, phone };
}

export interface ListingOpts { title?: string; priceMinor?: number; currency?: "USD" | "CDF"; categoryId?: string; areaId?: string; description?: string; photos?: string[] }

export async function apiListing(request: APIRequestContext, o: ListingOpts = {}): Promise<{ id: string; title: string }> {
  const title = o.title ?? uniqueTitle();
  const d = await request.post("/api/v1/items", {
    data: {
      title, description: o.description ?? "Article de test", categoryId: o.categoryId ?? ID.catRobes, condition: "good",
      priceMinor: o.priceMinor ?? 2500, currency: o.currency ?? "USD", areaId: o.areaId ?? ID.areaGombe, photos: o.photos ?? [PHOTO],
    },
  });
  expect(d.status(), `création d'annonce : ${await d.text()}`).toBe(201);
  const id = (await d.json()).item.id;
  const p = await request.post(`/api/v1/items/${id}/publish`, { data: {} });
  expect(p.status(), `publication : ${await p.text()}`).toBe(200);
  return { id, title };
}

export async function apiOrder(request: APIRequestContext, itemId: string): Promise<string> {
  const r = await request.post("/api/v1/orders", { data: { itemIds: [itemId], deliveryMethod: "hand_delivery" } });
  expect(r.status(), `commande : ${await r.text()}`).toBe(201);
  return (await r.json()).order.id;
}

export async function apiPay(request: APIRequestContext, orderId: string, msisdn: string, key = `key-${Date.now()}-${++seq}`) {
  return request.post(`/api/v1/orders/${orderId}/pay`, { data: { method: "mpesa", msisdn, idempotencyKey: key } });
}

export async function orderStatus(request: APIRequestContext, orderId: string): Promise<string> {
  const r = await request.get(`/api/v1/orders/${orderId}`);
  return (await r.json()).order?.status ?? `HTTP ${r.status()}`;
}

export async function waitForStatus(request: APIRequestContext, orderId: string, status: string, timeout = 20_000) {
  await expect.poll(() => orderStatus(request, orderId), { timeout, intervals: [300, 500, 1000] }).toBe(status);
}

/** Achète et paie par l'API, attend que la commande soit « payée ». */
export async function apiBuyAndPay(buyer: APIRequestContext, itemId: string, msisdn = "0821111111"): Promise<string> {
  const orderId = await apiOrder(buyer, itemId);
  const p = await apiPay(buyer, orderId, msisdn);
  expect(p.status(), `paiement : ${await p.text()}`).toBe(202);
  await waitForStatus(buyer, orderId, "paid");
  return orderId;
}

export async function apiCode(buyer: APIRequestContext, orderId: string): Promise<string> {
  const r = await buyer.get(`/api/v1/orders/${orderId}/handover-code`);
  expect(r.status()).toBe(200);
  return (await r.json()).code;
}

// ------------------------------------------------------------------------------------------ base (PostgreSQL)
let pool: Pool | null = null;
/** Accès direct à la base, seulement quand les tests tournent contre PostgreSQL (E2E_DATABASE_URL). */
export function db(): Pool | null {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) return null;
  pool ??= new Pool({ connectionString: url, max: 2 });
  return pool;
}
export const isPg = () => !!process.env.E2E_DATABASE_URL;

// -------------------------------------------------------------------------------------------- accessibilité
export interface A11yIssue { id: string; impact: string; help: string; nodes: number; sample: string }

export async function scan(page: Page): Promise<A11yIssue[]> {
  const r = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  return r.violations.map((v) => ({ id: v.id, impact: v.impact ?? "n/a", help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.html.slice(0, 140) ?? "" }));
}

/** Attend que la page soit hydratée : avant, les clics et touches sont perdus. */
export async function ready(page: Page) {
  await page.waitForSelector('html[data-hydrated="1"]', { timeout: 30_000 });
}

export async function open(page: Page, url: string) {
  const r = await page.goto(url);
  await ready(page).catch(() => undefined);
  return r;
}

/** Connexion par l'interface, au clavier seulement. */
export async function signInUi(page: Page, phone: string, name?: string, next = "/") {
  await open(page, `/signin${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.keyboard.type(phone, { delay: 15 });
  await page.keyboard.press("Enter");
  await page.getByText("Code reçu par SMS").waitFor();
  await page.keyboard.type(OTP, { delay: 30 });
  if (name) {
    await page.getByLabel("Comment t'appeler ?").waitFor();
    await page.keyboard.type(name, { delay: 10 });
    await page.keyboard.press("Enter");
  }
}

/** JPEG généré dans le navigateur (aucun fichier sur disque). */
export async function jpegBuffer(page: Page, w = 800, h = 1000): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#bcd4e6"); g.addColorStop(1, "#4a6fa5");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "#ffffffaa"; x.beginPath(); x.arc(w / 2, h / 2, Math.min(w, h) / 4, 0, 7); x.fill();
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, [w, h]);
  return Buffer.from(b64, "base64");
}

export const file = (buffer: Buffer, name = "photo.jpg", mimeType = "image/jpeg") => ({ name, mimeType, buffer });

/** Vrai si la page ne déborde pas horizontalement. */
export async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

export const money = (s: string) => s.replace(/[  ]/g, " ");

/** Les vraies alertes de l'application, sans l'annonceur de routes de Next.js (toujours présent et vide). */
export const alerts = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
