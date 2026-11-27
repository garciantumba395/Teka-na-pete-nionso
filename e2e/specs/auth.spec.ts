import { randomUUID } from "node:crypto";
import { OTP, alerts, apiListing, apiOrder, expect, open, randomIp, signInUi, signUp, test, uniquePhone } from "../support";
import type { APIRequestContext } from "@playwright/test";

const post = (r: APIRequestContext, path: string, data: unknown, ip = randomIp()) => r.post(path, { data, headers: { "x-forwarded-for": ip } });
const otp = (r: APIRequestContext, phone: string) => post(r, "/api/v1/auth/otp", { phone });
const verify = (r: APIRequestContext, phone: string, code: string, displayName?: string) => post(r, "/api/v1/auth/otp/verify", { phone, code, displayName });
let n = 0;
const nat9 = () => `8${String(Date.now() % 1e5).padStart(5, "0")}${String(++n).padStart(3, "0")}`.slice(0, 9);

test.describe("A Connexion et compte", () => {
  test("A-H1 inscription au clavier seul : numéro, Entrée, code, nom, Entrée", async ({ page }) => {
    const phone = uniquePhone();
    await signInUi(page, phone, "Nadine Clavier");
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await open(page, "/me");
    await expect(page.locator("main").getByText("Nadine Clavier").first()).toBeVisible();
  });

  test("A-E1 formats de numéro : valides normalisés, invalides refusés", async ({ request }) => {
    // Un numéro DIFFÉRENT par format : la limite de 3 envois par numéro et par 10 minutes s'applique (et fonctionne).
    const shapes = [(d: string) => `+243 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`, (d: string) => `0${d}`, (d: string) => d, (d: string) => `+243(${d.slice(0, 2)})${d.slice(2, 5)}-${d.slice(5)}`, (d: string) => `00243 ${d}`];
    for (const shape of shapes) {
      const d = nat9();
      const f = shape(d);
      const r = await otp(request, f);
      expect(r.status(), `numéro « ${f} »`).toBe(200);
      expect((await r.json()).phone).toBe(`+243${d}`);
    }
    for (const bad of ["abcdefghij", "08100", "0710000001", "+33612345678", "", "0810000001234", "+243 81 000 00"]) {
      const r = await otp(request, bad);
      expect(r.status(), `numéro invalide « ${bad} »`).toBe(422);
    }
  });

  test("A-E2 5 mauvais codes verrouillent, un nouveau code débloque", async ({ request }) => {
    const phone = uniquePhone();
    await otp(request, phone);
    for (let i = 0; i < 5; i++) {
      const r = await verify(request, phone, "000000", "Verrou Test");
      expect((await r.json()).error.code).toBe("OTP_WRONG");
    }
    const locked = await verify(request, phone, OTP, "Verrou Test");
    expect(locked.status()).toBe(429);
    expect((await locked.json()).error.code).toBe("OTP_LOCKED");
    await otp(request, phone);
    expect((await verify(request, phone, OTP, "Verrou Test")).status()).toBe(200);
  });

  test("A-E3 coller le code à 6 chiffres dans la première case", async ({ page, context, request }) => {
    const phone = uniquePhone();
    await signUp(request, phone, "Colleur");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "/signin");
    await page.keyboard.type(phone, { delay: 15 });
    await page.keyboard.press("Enter");
    await page.getByText("Code reçu par SMS").waitFor();
    await page.evaluate((c) => navigator.clipboard.writeText(c), OTP);
    await page.locator(".otp input").first().click();
    await page.keyboard.press("Control+V");
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  });

  test("A-E4 des lettres tapées dans les cases du code sont ignorées", async ({ page }) => {
    await open(page, "/signin");
    await page.keyboard.type(uniquePhone(), { delay: 15 });
    await page.keyboard.press("Enter");
    await page.getByText("Code reçu par SMS").waitFor();
    await page.keyboard.type("ab12cd", { delay: 30 });
    const values = await page.locator(".otp input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(values.join("")).toBe("12");
  });

  test("A-E5 4 codes pour le même numéro : le 4e est refusé ; compte à rebours de renvoi", async ({ request, page }) => {
    const phone = uniquePhone();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await otp(request, phone)).status());
    expect(codes).toEqual([200, 200, 200, 429]);
    await open(page, "/signin");
    await page.keyboard.type(uniquePhone(), { delay: 15 });
    await page.keyboard.press("Enter");
    await page.getByText("Code reçu par SMS").waitFor();
    await expect(page.getByRole("button", { name: /Renvoyer dans \d+ s/ })).toBeDisabled();
  });

  test("A-E6 25 demandes depuis la même adresse : 429 avec Retry-After", async ({ request }) => {
    const ip = randomIp();
    let limited = 0, retry: string | undefined;
    for (let i = 0; i < 25; i++) {
      const r = await post(request, "/api/v1/auth/otp", { phone: "12345" }, ip);
      if (r.status() === 429) { limited++; retry = r.headers()["retry-after"]; }
    }
    expect(limited).toBeGreaterThanOrEqual(4);
    expect(Number(retry)).toBeGreaterThan(0);
  });

  test("A-E7 ?next= malveillant : on reste sur notre site", async ({ makeActor }) => {
    const a = await makeActor("Redirige");
    const origin = new URL(process.env.BASE_URL ?? "http://localhost:3100").origin;
    for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/\\/evil.com", "////evil.com", " //evil.com"]) {
      await a.page.goto(`/signin?next=${encodeURIComponent(next)}`);
      expect(new URL(a.page.url()).origin, `next=${next}`).toBe(origin);
    }
    await a.page.goto(`/signin?next=${encodeURIComponent("/wallet")}`);
    await expect(a.page).toHaveURL(/\/wallet$/); // un chemin légitime est respecté
  });

  test("A-E7b ?next= malveillant après une vraie connexion par l'interface", async ({ page }) => {
    await signInUi(page, uniquePhone(), "Nouveau Malin", "//evil.com");
    await expect(page).toHaveURL(`${new URL(process.env.BASE_URL ?? "http://localhost:3100").origin}/`, { timeout: 15_000 });
  });

  test("A-E8 pages protégées sans session : vrai 307 vers la connexion", async ({ request }) => {
    const id = randomUUID();
    for (const path of ["/sell", "/wallet", "/me", `/orders/${id}`, `/orders/${id}/pay`]) {
      const r = await request.get(path, { maxRedirects: 0 });
      expect(r.status(), path).toBe(307);
      expect(r.headers().location, path).toMatch(/^\/signin\?next=/);
    }
  });

  test("A-E9 se déconnecter puis Retour : aucune donnée privée, session invalide", async ({ makeActor }) => {
    const a = await makeActor("Privé Total");
    await open(a.page, "/me");
    await expect(a.page.getByText("Mes commandes")).toBeVisible();
    await a.page.getByRole("button", { name: "Me déconnecter" }).click();
    await expect(a.page).toHaveURL(/\/$/);
    expect((await a.request.get("/api/v1/me")).status()).toBe(401);
    await a.page.goBack();
    await a.page.waitForTimeout(1500);
    expect(await a.page.getByText("Mes commandes").count(), "après Retour, la page privée ne doit plus s'afficher").toBe(0);
    await open(a.page, "/wallet");
    await expect(a.page).toHaveURL(/\/signin/);
  });

  test("A-E10 « se déconnecter partout » révoque la session d'un autre appareil", async ({ makeActor, browser }) => {
    const a = await makeActor("Multi appareils");
    const ctx2 = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": randomIp() }, baseURL: process.env.BASE_URL ?? "http://localhost:3100" });
    await otp(ctx2.request, a.phone);
    expect((await verify(ctx2.request, a.phone, OTP)).status()).toBe(200);
    expect((await ctx2.request.get("/api/v1/me")).status()).toBe(200);
    expect((await a.request.post("/api/v1/auth/logout-all")).status()).toBe(200);
    expect((await ctx2.request.get("/api/v1/me")).status()).toBe(401);
    await ctx2.close();
  });

  test("A-E11 supprimer son compte : refusé avec une commande ouverte, puis accepté ; numéro libéré", async ({ makeActor, browser }) => {
    const seller = await makeActor("Vendeur suppr");
    const a = await makeActor("À supprimer");
    const item = await apiListing(seller.request);
    const orderId = await apiOrder(a.request, item.id);
    const refused = await a.request.delete("/api/v1/me");
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error.code).toBe("ACCOUNT_HAS_OPEN_ORDERS");
    await a.request.post(`/api/v1/orders/${orderId}/cancel`, { data: {} });
    const sid = (await a.context.cookies()).find((c) => /sid$/.test(c.name))!;
    expect((await a.request.delete("/api/v1/me")).status()).toBe(200);
    const ctx2 = await browser.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3100" });
    await ctx2.addCookies([{ name: sid.name, value: sid.value, url: process.env.BASE_URL ?? "http://localhost:3100" }]);
    expect((await ctx2.request.get("/api/v1/me")).status(), "l'ancien cookie ne doit plus fonctionner").toBe(401);
    await ctx2.close();
    const again = await signUp(a.request, a.phone, "Nouveau Compte"); // le numéro est libéré : un NOUVEAU compte se crée
    expect(again.id).not.toBe(a.userId);
  });

  test("A-E12 cookie de session : HttpOnly, SameSite=Lax, jeton opaque", async ({ makeActor }) => {
    const a = await makeActor("Cookie");
    const c = (await a.context.cookies()).find((x) => /sid$/.test(x.name))!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    expect(c.value.length).toBeGreaterThanOrEqual(40);
    expect(c.value).not.toContain(a.userId);
  });

  test("A-E13 noms : emoji accepté ; trop court, trop long, espaces refusés ; HTML jamais interprété", async ({ request, makeActor }) => {
    const reg = async (name: string) => { const p = uniquePhone(); await otp(request, p); return verify(request, p, OTP, name); };
    expect((await reg("Zoé 🌍")).status()).toBe(200);
    for (const bad of ["A", "x".repeat(41), "   ", ""]) {
      const r = await reg(bad);
      expect(r.status(), `nom « ${bad} »`).toBe(422);
      expect((await r.json()).error.code).toBe("NAME_REQUIRED");
    }
    const evil = await makeActor("<img src=x onerror=window.__xss=1>");
    let dialogs = 0;
    evil.page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });
    const item = await apiListing(evil.request);
    for (const url of ["/me", `/members/${evil.userId}`, `/items/${item.id}`]) {
      await open(evil.page, url);
      expect(await evil.page.evaluate(() => (window as unknown as { __xss?: number }).__xss), url).toBeUndefined();
    }
    expect(dialogs).toBe(0);
  });

  test("A-N1 mêmes réponses pour un numéro connu et inconnu (pas d'énumération des comptes)", async ({ request }) => {
    const known = uniquePhone();
    await signUp(request, known, "Connu");
    const unknown = uniquePhone();
    const shape = async (phone: string) => {
      const a = await verify(request, phone, "654321"); // sans code demandé
      await otp(request, phone);
      const b = await verify(request, phone, "654321"); // mauvais code
      return [a.status(), (await a.json()).error.code, b.status(), (await b.json()).error.code];
    };
    expect(await shape(known)).toEqual(await shape(unknown));
  });
});
