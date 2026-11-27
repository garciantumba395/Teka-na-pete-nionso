/* Parcours E2E de la tranche verticale M0 : vendre, acheter, payer, remettre avec le code, retirer.
 * Prérequis : l'appli tourne sur BASE_URL (par défaut http://localhost:3100) avec la couche de données factice.
 *   npm run build && npm start      puis      npm run e2e
 * Sorties : captures dans replica/clone-screens/, code de sortie 1 au premier échec.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
/** Même UUID déterministe que src/lib/data/ids.ts */
function seedId(name) {
  const h = crypto.createHash("sha1").update(`marketplace-rdc:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20,32)}`;
}

const BASE = process.env.BASE_URL || "http://localhost:3100";
const OUT = path.join(__dirname, "..", "replica", "clone-screens");
fs.mkdirSync(OUT, { recursive: true });

const log = [];
const warnings = [];
const apiStatuses = [];
let failures = 0;

function check(cond, msg) {
  log.push(`${cond ? "OK  " : "FAIL"} ${msg}`);
  if (!cond) failures++;
}
const nb = (s) => s.replace(/[  ]/g, " ");

// Réponses 4xx attendues (parcours d'erreur volontaires). Toute autre 4xx/5xx fait échouer le parcours.
const EXPECTED_4XX = [/\/auth\/otp$/, /\/auth\/otp\/verify$/, /\/orders\/[^/]+\/confirm-delivery$/, /\/items\/[^/]+\/publish$/];


/** Navigue puis attend que la page soit interactive (hydratée) : les clics et touches avant ce moment sont perdus. */
async function open(page, url) {
  const r = await page.goto(url);
  await page.waitForSelector('html[data-hydrated="1"]', { timeout: 30000 }).catch(() => undefined);
  return r;
}

function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) {
      check(false, `[${label}] erreur console : ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => check(false, `[${label}] exception page : ${e}`));
  page.on("response", (r) => {
    const s = r.status();
    const u = new URL(r.url());
    if (!u.pathname.startsWith("/api/") || s < 400) return;
    apiStatuses.push(`${s} ${u.pathname}`);
    if (s >= 500 || !EXPECTED_4XX.some((re) => re.test(u.pathname))) check(false, `[${label}] réponse inattendue ${s} ${u.pathname}`);
  });
}

async function noOverflow(page, label) {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(ok, `${label} : pas de défilement horizontal`);
}

/** Capture à la hauteur réelle de la page : les barres fixes restent en bas, pas au milieu comme avec fullPage. */
async function shot(page, name) {
  const vp = page.viewportSize();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, window.innerHeight));
  await page.setViewportSize({ width: vp.width, height: Math.min(h, 6000) });
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  await page.setViewportSize(vp);
}

/** Connexion au clavier seulement : numéro, Entrée, code à 6 chiffres, (nom, Entrée). */
async function signInKeyboard(page, phone, name) {
  await open(page, `${BASE}/signin`);
  await page.keyboard.type(phone, { delay: 20 }); // autoFocus sur le champ du numéro
  await page.keyboard.press("Enter");
  await page.getByText("Code reçu par SMS").waitFor();
  await page.keyboard.type("123456", { delay: 40 }); // une case par chiffre, soumission automatique à la 6e
  if (name) {
    await page.getByLabel("Comment t'appeler ?").waitFor();
    await page.keyboard.type(name, { delay: 10 });
    await page.keyboard.press("Enter");
  }
  await page.waitForURL(`${BASE}/`, { timeout: 10000 });
}

async function makePhotos(browser, dir) {
  const page = await browser.newPage();
  const files = [];
  for (let i = 0; i < 2; i++) {
    const b64 = await page.evaluate((i) => {
      const c = document.createElement("canvas");
      c.width = 1600; c.height = 2000; // plus grand que 1280 : la compression doit réduire
      const x = c.getContext("2d");
      const g = x.createLinearGradient(0, 0, 1600, 2000);
      g.addColorStop(0, i ? "#e8d5b5" : "#bcd4e6"); g.addColorStop(1, i ? "#c97b4a" : "#4a6fa5");
      x.fillStyle = g; x.fillRect(0, 0, 1600, 2000);
      x.fillStyle = "#ffffffaa"; x.beginPath(); x.arc(800, 800, 380, 0, 7); x.fill();
      x.fillStyle = "#00000055"; x.fillRect(560, 1180, 480, 480);
      return c.toDataURL("image/jpeg", 0.95).split(",")[1];
    }, i);
    const f = path.join(dir, `photo${i + 1}.jpg`);
    fs.writeFileSync(f, Buffer.from(b64, "base64"));
    files.push(f);
  }
  await page.close();
  return files;
}

let browser;
(async () => {
  browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-"));
  const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 };
  const photos = await makePhotos(browser, tmp);

  const sellerCtx = await browser.newContext(mobile);
  const buyerCtx = await browser.newContext(mobile);
  const desktopCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const seller = await sellerCtx.newPage();
  const buyer = await buyerCtx.newPage();
  const desk = await desktopCtx.newPage();
  watch(seller, "vendeur"); watch(buyer, "acheteur"); watch(desk, "bureau");

  // ---------------------------------------------------------------- S01 accueil, S03 recherche
  await open(buyer, `${BASE}/`);
  await buyer.getByRole("heading", { name: "Dernières annonces" }).waitFor();
  const n = await buyer.locator("ul.grid > li").count();
  check(n >= 12, `S01 : ${n} annonces affichées (seed)`);
  await noOverflow(buyer, "S01 390px");
  await shot(buyer, "S01");
  await open(desk, `${BASE}/`);
  await desk.getByRole("navigation", { name: "Navigation principale" }).waitFor();
  await desk.getByRole("heading", { name: "Dernières annonces" }).waitFor();
  await desk.locator("ul.grid > li").first().waitFor();
  check(await desk.locator(".tabbar-fixed").isHidden(), "S01 1440px : barre d'onglets mobile masquée, navigation en haut");
  await noOverflow(desk, "S01 1440px");
  await shot(desk, "S01-desktop");

  await open(buyer, `${BASE}/search?area=${seedId("area-com-gombe")}&radius=3`);
  const near = await buyer.getByRole("status").first().innerText();
  const nearCount = Number(near.match(/\d+/)?.[0] ?? -1);
  check(nearCount > 0 && nearCount < n, `S03 : rayon 3 km autour de Gombe = ${nearCount} résultats (moins que les ${n} totaux)`);
  await noOverflow(buyer, "S03 390px");
  await shot(buyer, "S03");
  await open(buyer, `${BASE}/search?q=ecouteurs`);
  check((await buyer.getByText("Écouteurs filaires").count()) > 0, "S03 : recherche sans accents « ecouteurs » trouve « Écouteurs filaires »");
  await open(buyer, `${BASE}/search?q=zzzz-introuvable`);
  check(await buyer.getByText("Aucun résultat").first().isVisible(), "S03 : état vide « Aucun résultat »");

  // ---------------------------------------------------------------- S02 connexion (vendeur existant, puis acheteur nouveau)
  await signInKeyboard(seller, "0810000001", null);
  await open(seller, `${BASE}/me`);
  await seller.locator("main").getByText("Marie K.").first().waitFor();
  check(true, "S02 : le vendeur seed se connecte au clavier, sans demande de nom");
  await open(seller, `${BASE}/signin`);
  await seller.waitForURL(`${BASE}/`); // déjà connecté : redirigé
  check(true, "S02 : /signin redirige un membre connecté");

  await open(buyer, `${BASE}/signin`);
  await buyer.keyboard.type("12345");
  await buyer.keyboard.press("Enter");
  await buyer.getByRole("alert").filter({ hasText: "Numéro de téléphone invalide" }).waitFor();
  check(true, "S02 : numéro invalide refusé avec un message");
  await buyer.locator("#phone").fill("");
  await buyer.keyboard.type("0831234567");
  await buyer.keyboard.press("Enter");
  await buyer.getByText("Code reçu par SMS").waitFor();
  await shot(buyer, "S02");
  await buyer.keyboard.type("000000", { delay: 40 });
  await buyer.getByRole("alert").filter({ hasText: "Code incorrect" }).waitFor();
  check(await buyer.locator(".otp input").first().evaluate((el) => el === document.activeElement), "S02 : après un code faux, le focus revient sur la première case");
  await buyer.keyboard.type("123456", { delay: 40 });
  await buyer.getByLabel("Comment t'appeler ?").waitFor();
  await buyer.keyboard.type("Nadine T.", { delay: 10 });
  await buyer.keyboard.press("Enter");
  await buyer.waitForURL(`${BASE}/`);
  check(true, "S02 : un nouvel acheteur crée son compte au clavier (numéro, code, nom)");

  // ---------------------------------------------------------------- S05 vendre
  await open(seller, `${BASE}/sell`);
  await seller.getByRole("button", { name: "Publier l'annonce" }).click();
  check(await seller.getByRole("alert").filter({ hasText: "Corrige les champs signalés" }).first().isVisible(), "S05 : formulaire vide, erreurs affichées");
  check((await seller.locator("#title-err, #categoryId-err, #condition-err, #priceMinor-err").count()) >= 3, "S05 : une erreur par champ requis");
  await shot(seller, "S05-errors");
  await seller.setInputFiles('input[type="file"]', photos);
  await seller.locator(".photos-strip .thumb img").nth(1).waitFor({ state: "attached" });
  const thumbSize = await seller.locator(".photos-strip .thumb img").first().evaluate((el) => el.src.length);
  const origSize = fs.statSync(photos[0]).size;
  check(thumbSize < origSize * 1.4 && thumbSize < 550000, `S05 : photo compressée avant envoi (${Math.round(origSize / 1024)} Ko -> ~${Math.round((thumbSize * 0.75) / 1024)} Ko)`);
  await seller.locator("#title").fill("Robe test E2E");
  await seller.locator("#description").fill("Portée une fois, aucun défaut.");
  await seller.locator("#categoryId").selectOption({ label: "Robes" });
  await seller.locator("#condition").selectOption({ label: "Très bon état" });
  await seller.locator("#sizeLabel").fill("M");
  await seller.locator("#brand").fill("Test");
  await seller.locator("#priceMinor").fill("25");
  await noOverflow(seller, "S05 390px");
  await shot(seller, "S05");
  await seller.getByRole("button", { name: "Publier l'annonce" }).click();
  await seller.waitForURL(/\/items\/[^/]+$/);
  const itemUrl = seller.url();
  await seller.getByRole("heading", { name: "Robe test E2E" }).waitFor();
  check(true, "S05 -> S04 : annonce publiée et affichée");

  // ---------------------------------------------------------------- S04 fiche article
  await open(buyer, itemUrl);
  await buyer.getByRole("heading", { name: "Robe test E2E" }).waitFor();
  check(nb(await buyer.locator(".price").first().innerText()) === "25 $", "S04 : prix 25 $");
  check(nb(await buyer.locator(".price-incl").first().innerText()).includes("26,25 $"), "S04 : prix avec protection 26,25 $ (5 %)");
  check((await buyer.locator(".gallery img").count()) === 2, "S04 : 2 photos dans la galerie");
  await noOverflow(buyer, "S04 390px");
  await shot(buyer, "S04");
  await open(desk, itemUrl);
  await desk.getByRole("heading", { name: "Robe test E2E" }).waitFor();
  await noOverflow(desk, "S04 1440px");
  await shot(desk, "S04-desktop");
  await open(seller, itemUrl);
  check(await seller.getByText("C'est ton annonce").isVisible() && (await seller.getByRole("button", { name: /^Acheter/ }).count()) === 0, "S04 : le vendeur ne peut pas acheter son propre article");

  // ---------------------------------------------------------------- S08 paiement
  await buyer.getByRole("button", { name: /^Acheter/ }).click();
  await buyer.waitForURL(/\/orders\/[^/]+\/pay$/);
  const orderId = buyer.url().split("/")[4];
  check(nb(await buyer.locator("dd.total").innerText()) === "26,25 $", "S08 : total 26,25 $ (25 + 1,25 de protection), calculé par le serveur");
  await noOverflow(buyer, "S08 390px");
  await shot(buyer, "S08");
  // un second acheteur ne peut pas prendre le même article
  const other = await browser.newContext(mobile);
  const op = await other.newPage();
  watch(op, "autre");
  await signInKeyboard(op, "0821000009", "Autre Acheteur");
  await open(op, itemUrl);
  check(await op.getByText("Réservé").first().isVisible() && (await op.getByRole("button", { name: /^Acheter/ }).count()) === 0, "S04 : pendant le paiement, l'article apparaît « Réservé » pour un autre acheteur");
  await other.close();

  await buyer.getByRole("button", { name: /^Payer/ }).click();
  await buyer.getByText("Valide le paiement sur ton téléphone").waitFor();
  await shot(buyer, "S08-pending");
  await buyer.waitForURL(`${BASE}/orders/${orderId}`, { timeout: 20000 });
  check(true, "S08 : le paiement est validé par le fournisseur factice et l'écran bascule tout seul sur la commande");

  // ---------------------------------------------------------------- S09 commande, code de remise
  await buyer.getByText("Paiement reçu").first().waitFor();
  check(!(await buyer.locator(".code").count()), "S09 : le code de remise est caché par défaut");
  await buyer.getByRole("button", { name: "Afficher mon code" }).click();
  const label = await buyer.getByRole("img", { name: /Code de remise/ }).getAttribute("aria-label");
  const code = label.replace(/\D/g, "");
  check(/^\d{6}$/.test(code), `S09 : l'acheteur voit son code à 6 chiffres (${code.replace(/\d/g, "•")})`);
  await noOverflow(buyer, "S09 acheteur 390px");
  await shot(buyer, "S09");
  const noAuth = await desk.request.get(`${BASE}/orders/${orderId}`, { maxRedirects: 0 });
  check(noAuth.status() === 307 && (noAuth.headers().location || "").startsWith("/signin?next="), `S09 : sans connexion, vrai code HTTP 307 vers la connexion (reçu ${noAuth.status()})`);
  await open(desk, `${BASE}/orders/${orderId}`);
  await desk.waitForURL(/\/signin\?next=/);
  check(true, "S09 : le navigateur arrive sur la page de connexion");

  await open(seller, `${BASE}/orders/${orderId}`);
  await seller.getByText("Code de l'acheteur").first().waitFor();
  await seller.locator(".otp input").first().click();
  await seller.keyboard.type("000000", { delay: 40 });
  await seller.getByRole("alert").filter({ hasText: "Il te reste 4 essais" }).waitFor();
  check(true, "S09 : un mauvais code est refusé, avec le nombre d'essais restants");
  check(await seller.locator(".otp input").first().evaluate((el) => el === document.activeElement), "S09 : le focus revient sur la première case");
  await shot(seller, "S09-seller-wrong-code");
  await seller.keyboard.type(code, { delay: 40 });
  await seller.getByText("Vente terminée").waitFor({ timeout: 10000 });
  check(true, "S09 : le bon code termine la vente");
  await noOverflow(seller, "S09 vendeur 390px");
  await shot(seller, "S09-seller");
  await open(desk, `${BASE}/signin`);

  // l'acheteur voit la commande terminée sans recharger (rafraîchissement automatique)
  await buyer.getByText("Article reçu").waitFor({ timeout: 10000 });
  check(true, "S09 : l'écran de l'acheteur se met à jour tout seul quand le vendeur valide");

  // ---------------------------------------------------------------- S16 portefeuille et retrait
  await open(seller, `${BASE}/wallet`);
  check(nb(await seller.getByTestId("balance-USD").innerText()) === "25 $", "S16 : le vendeur reçoit 25 $ (le prix de l'article, sans les frais de protection)");
  await shot(seller, "S16");
  await seller.locator("#amount").fill("10");
  await seller.getByRole("button", { name: /^Retirer/ }).click();
  await seller.getByText("Retrait demandé").waitFor();
  await seller.getByText("Reçu").first().waitFor({ timeout: 15000 });
  check(true, "S16 : le retrait passe de « En cours » à « Reçu » tout seul");
  check(nb(await seller.getByTestId("balance-USD").innerText()) === "14,90 $", "S16 : solde 14,90 $ (25 - 10 - 0,10 de frais)");
  await noOverflow(seller, "S16 390px");
  await shot(seller, "S16-after-payout");
  await seller.locator("#amount").fill("1000");
  await seller.getByRole("button", { name: /^Retirer/ }).click();
  check(await seller.getByRole("alert").filter({ hasText: "ne couvre pas" }).isVisible(), "S16 : retrait supérieur au solde refusé");

  // ---------------------------------------------------------------- paiement refusé puis annulation
  await open(buyer, `${BASE}/items/${seedId("item-02")}`);
  await buyer.getByRole("button", { name: /^Acheter/ }).click();
  await buyer.waitForURL(/\/orders\/[^/]+\/pay$/);
  const order2 = buyer.url().split("/")[4];
  await buyer.locator("#msisdn").fill("820000100"); // numéro finissant par 00 : refus simulé
  await buyer.getByRole("button", { name: /^Payer/ }).click();
  await buyer.getByRole("alert").filter({ hasText: "Solde insuffisant" }).waitFor({ timeout: 15000 });
  check(true, "S08 : paiement refusé, message clair et possibilité de réessayer");
  await shot(buyer, "S08-failed");
  await open(buyer, `${BASE}/orders/${order2}`);
  await buyer.getByRole("button", { name: "Annuler la commande" }).click();
  await buyer.getByRole("button", { name: "Oui, annuler" }).click();
  await buyer.getByText("Commande annulée").waitFor();
  await open(buyer, `${BASE}/items/${seedId("item-02")}`);
  check(await buyer.getByRole("button", { name: /^Acheter/ }).isVisible(), "S09 : après annulation, l'article est de nouveau disponible");

  // ---------------------------------------------------------------- stubs : toutes les routes répondent
  for (const p of ["/inbox", "/favourites", "/pro", "/report", "/legal", `/orders/${orderId}/dispute`, `/orders/${orderId}/return`, `/orders/${orderId}/review`, `/orders/${orderId}/shipping`]) {
    const r = await open(buyer, `${BASE}${p}`);
    check(r.status() === 200 && (await buyer.getByText("Bientôt disponible").isVisible()), `Stub ${p} : état « Bientôt disponible »`);
  }
  for (const p of ["/items/inexistant", "/members/inexistant", `/orders/00000000-0000-0000-0000-000000000000`]) {
    const nf = await open(buyer, `${BASE}${p}`);
    check(nf.status() === 404 && (await buyer.getByText("Page introuvable").isVisible()), `${p} : vrai code 404 et page lisible (reçu ${nf.status()})`);
  }
  const mine = await open(buyer, `${BASE}/me`);
  check(mine.status() === 200 && (await buyer.getByText("Mes commandes").isVisible()), "S15 : profil et liste des commandes");
  await shot(buyer, "S15");
  await open(buyer, `${BASE}/members/${seedId("user-marie")}`);
  check(await buyer.getByRole("heading", { name: "Marie K." }).isVisible(), "S14 : profil public d'un vendeur");
  await shot(buyer, "S14");

  // ---------------------------------------------------------------- backend : session, limites, tâches, photos, suppression
  const ck = (await buyerCtx.cookies()).find((c) => /(^|-)sid$/.test(c.name));
  check(!!ck && ck.httpOnly && ck.sameSite === "Lax", "Session : cookie HttpOnly et SameSite=Lax");
  check(!!ck && !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(ck.value) && ck.value.length >= 40, "Session : le cookie est un jeton opaque, il ne contient pas l'identifiant du membre");

  const firstImg = await open(buyer, `${BASE}/items/${seedId("item-02")}`).then(() => buyer.locator(".gallery img").first().getAttribute("src"));
  if (firstImg && firstImg.startsWith("/api/v1/photos/")) {
    const ph = await buyerCtx.request.get(`${BASE}${firstImg}`);
    const h = ph.headers();
    check(ph.status() === 200 && /^image\//.test(h["content-type"] || ""), `Photos : servies depuis la base (${h["content-type"]})`);
    check((h["cache-control"] || "").includes("immutable") && h["x-content-type-options"] === "nosniff", "Photos : cache immuable (économie de données) et nosniff");
    check((h["content-security-policy"] || "").includes("sandbox"), "Photos : en-tête CSP sandbox (aucun contenu actif exécuté)");
    check((await buyerCtx.request.get(`${BASE}/api/v1/photos/inexistant`)).status() === 404, "Photos : identifiant invalide = 404");
  }

  // limitation de débit : on isole une adresse IP de test pour ne pas gêner le reste du parcours
  let limited = 0, retryAfter = null;
  for (let i = 0; i < 25; i++) {
    const r = await buyerCtx.request.post(`${BASE}/api/v1/auth/otp`, { data: { phone: "12345" }, headers: { "x-forwarded-for": "203.0.113.77" } });
    if (r.status() === 429) { limited++; retryAfter = r.headers()["retry-after"]; }
  }
  check(limited >= 4 && !!retryAfter, `Limite de débit : ${limited} réponses 429 sur 25 appels, avec Retry-After (${retryAfter})`);

  const cron = process.env.CRON_SECRET;
  if (cron) {
    check((await buyerCtx.request.get(`${BASE}/api/internal/jobs/purge_expired`)).status() === 401, "Tâches : refusées sans secret");
    check((await buyerCtx.request.get(`${BASE}/api/internal/jobs/purge_expired`, { headers: { authorization: "Bearer faux-secret" } })).status() === 401, "Tâches : refusées avec un mauvais secret");
    const ok = await buyerCtx.request.get(`${BASE}/api/internal/jobs/all`, { headers: { authorization: `Bearer ${cron}` } });
    check(ok.status() === 200 && "expire_unpaid_orders" in (await ok.json()).result, "Tâches : exécutées avec le bon secret");
  }

  // « se déconnecter partout » depuis un appareil révoque la session de l'autre appareil
  const second = await browser.newContext(mobile);
  const sp = await second.newPage();
  watch(sp, "second appareil");
  await signInKeyboard(sp, "0831234567", null);
  check((await second.request.get(`${BASE}/api/v1/me`)).status() === 200, "Session : le second appareil est connecté");
  const out = await buyerCtx.request.post(`${BASE}/api/v1/auth/logout-all`);
  check(out.status() === 200, "Session : « se déconnecter partout » depuis le premier appareil");
  check((await second.request.get(`${BASE}/api/v1/me`)).status() === 401, "Session : la session du second appareil est révoquée côté serveur (le cookie ne sert plus à rien)");
  await second.close();

  // suppression de compte : anonymisation, déconnexion, numéro libéré
  const gone = await browser.newContext(mobile);
  const gp = await gone.newPage();
  watch(gp, "compte jetable");
  await signInKeyboard(gp, "0841234567", "Compte Jetable");
  const del = await gone.request.delete(`${BASE}/api/v1/me`);
  check(del.status() === 200, "Compte : suppression acceptée (aucune commande ouverte, aucun solde)");
  check((await gone.request.get(`${BASE}/api/v1/me`)).status() === 401, "Compte : la session est révoquée après la suppression");
  const gp2 = await (await browser.newContext(mobile)).newPage();
  watch(gp2, "compte recréé");
  await signInKeyboard(gp2, "0841234567", "Nouveau Nom");
  await open(gp2, `${BASE}/me`);
  await gp2.locator("main").getByText("Nouveau Nom").first().waitFor();
  check(true, "Compte : le numéro est libéré, un nouveau compte peut être créé avec");

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(log.join("\n"));
  console.log(`\nRéponses API 4xx observées (attendues) : ${apiStatuses.length ? apiStatuses.join(", ") : "aucune"}`);
  console.log(`\n${failures === 0 ? "PARCOURS RÉUSSI" : `ÉCHEC : ${failures} vérification(s)`} (${log.filter((l) => l.startsWith("OK")).length} OK)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.log(log.join("\n"));
  console.error("\nERREUR :", e.message);
  await browser?.close().catch(() => undefined); // jamais de navigateur orphelin, même en cas d'échec
  process.exit(1);
});
