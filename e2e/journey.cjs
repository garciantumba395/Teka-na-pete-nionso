/* Parcours E2E de la tranche verticale M0 : vendre, acheter, payer, remettre avec le code, retirer.
 * Prérequis : l'appli tourne sur BASE_URL (par défaut http://localhost:3100) avec la couche de données factice.
 *   npm run build && npm start      puis      npm run e2e
 * Sorties : captures dans replica/clone-screens/, code de sortie 1 au premier échec.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
  await page.goto(`${BASE}/signin`);
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

(async () => {
  const browser = await chromium.launch();
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
  await buyer.goto(`${BASE}/`);
  await buyer.getByRole("heading", { name: "Dernières annonces" }).waitFor();
  const n = await buyer.locator("ul.grid > li").count();
  check(n >= 12, `S01 : ${n} annonces affichées (seed)`);
  await noOverflow(buyer, "S01 390px");
  await shot(buyer, "S01");
  await desk.goto(`${BASE}/`);
  await desk.getByRole("navigation", { name: "Navigation principale" }).waitFor();
  await desk.getByRole("heading", { name: "Dernières annonces" }).waitFor();
  await desk.locator("ul.grid > li").first().waitFor();
  check(await desk.locator(".tabbar-fixed").isHidden(), "S01 1440px : barre d'onglets mobile masquée, navigation en haut");
  await noOverflow(desk, "S01 1440px");
  await shot(desk, "S01-desktop");

  await buyer.goto(`${BASE}/search?area=area-com-gombe&radius=3`);
  const near = await buyer.getByRole("status").first().innerText();
  const nearCount = Number(near.match(/\d+/)?.[0] ?? -1);
  check(nearCount > 0 && nearCount < n, `S03 : rayon 3 km autour de Gombe = ${nearCount} résultats (moins que les ${n} totaux)`);
  await noOverflow(buyer, "S03 390px");
  await shot(buyer, "S03");
  await buyer.goto(`${BASE}/search?q=ecouteurs`);
  check((await buyer.getByText("Écouteurs filaires").count()) > 0, "S03 : recherche sans accents « ecouteurs » trouve « Écouteurs filaires »");
  await buyer.goto(`${BASE}/search?q=zzzz-introuvable`);
  check(await buyer.getByText("Aucun résultat").first().isVisible(), "S03 : état vide « Aucun résultat »");

  // ---------------------------------------------------------------- S02 connexion (vendeur existant, puis acheteur nouveau)
  await signInKeyboard(seller, "0810000001", null);
  await seller.goto(`${BASE}/me`);
  await seller.locator("main").getByText("Marie K.").first().waitFor();
  check(true, "S02 : le vendeur seed se connecte au clavier, sans demande de nom");
  await seller.goto(`${BASE}/signin`);
  await seller.waitForURL(`${BASE}/`); // déjà connecté : redirigé
  check(true, "S02 : /signin redirige un membre connecté");

  await buyer.goto(`${BASE}/signin`);
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
  await seller.goto(`${BASE}/sell`);
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
  await buyer.goto(itemUrl);
  await buyer.getByRole("heading", { name: "Robe test E2E" }).waitFor();
  check(nb(await buyer.locator(".price").first().innerText()) === "25 $", "S04 : prix 25 $");
  check(nb(await buyer.locator(".price-incl").first().innerText()).includes("26,25 $"), "S04 : prix avec protection 26,25 $ (5 %)");
  check((await buyer.locator(".gallery img").count()) === 2, "S04 : 2 photos dans la galerie");
  await noOverflow(buyer, "S04 390px");
  await shot(buyer, "S04");
  await desk.goto(itemUrl);
  await desk.getByRole("heading", { name: "Robe test E2E" }).waitFor();
  await noOverflow(desk, "S04 1440px");
  await shot(desk, "S04-desktop");
  await seller.goto(itemUrl);
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
  await op.goto(itemUrl);
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
  await desk.goto(`${BASE}/orders/${orderId}`);
  await desk.waitForURL(/\/signin\?next=/);
  check(true, "S09 : le navigateur arrive sur la page de connexion");

  await seller.goto(`${BASE}/orders/${orderId}`);
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
  await desk.goto(`${BASE}/signin`);

  // l'acheteur voit la commande terminée sans recharger (rafraîchissement automatique)
  await buyer.getByText("Article reçu").waitFor({ timeout: 10000 });
  check(true, "S09 : l'écran de l'acheteur se met à jour tout seul quand le vendeur valide");

  // ---------------------------------------------------------------- S16 portefeuille et retrait
  await seller.goto(`${BASE}/wallet`);
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
  await buyer.goto(`${BASE}/items/item-02`);
  await buyer.getByRole("button", { name: /^Acheter/ }).click();
  await buyer.waitForURL(/\/orders\/[^/]+\/pay$/);
  const order2 = buyer.url().split("/")[4];
  await buyer.locator("#msisdn").fill("820000100"); // numéro finissant par 00 : refus simulé
  await buyer.getByRole("button", { name: /^Payer/ }).click();
  await buyer.getByRole("alert").filter({ hasText: "Solde insuffisant" }).waitFor({ timeout: 15000 });
  check(true, "S08 : paiement refusé, message clair et possibilité de réessayer");
  await shot(buyer, "S08-failed");
  await buyer.goto(`${BASE}/orders/${order2}`);
  await buyer.getByRole("button", { name: "Annuler la commande" }).click();
  await buyer.getByRole("button", { name: "Oui, annuler" }).click();
  await buyer.getByText("Commande annulée").waitFor();
  await buyer.goto(`${BASE}/items/item-02`);
  check(await buyer.getByRole("button", { name: /^Acheter/ }).isVisible(), "S09 : après annulation, l'article est de nouveau disponible");

  // ---------------------------------------------------------------- stubs : toutes les routes répondent
  for (const p of ["/inbox", "/favourites", "/pro", "/report", "/legal", `/orders/${orderId}/dispute`, `/orders/${orderId}/return`, `/orders/${orderId}/review`, `/orders/${orderId}/shipping`]) {
    const r = await buyer.goto(`${BASE}${p}`);
    check(r.status() === 200 && (await buyer.getByText("Bientôt disponible").isVisible()), `Stub ${p} : état « Bientôt disponible »`);
  }
  for (const p of ["/items/inexistant", "/members/inexistant", `/orders/00000000-0000-0000-0000-000000000000`]) {
    const nf = await buyer.goto(`${BASE}${p}`);
    check(nf.status() === 404 && (await buyer.getByText("Page introuvable").isVisible()), `${p} : vrai code 404 et page lisible (reçu ${nf.status()})`);
  }
  const mine = await buyer.goto(`${BASE}/me`);
  check(mine.status() === 200 && (await buyer.getByText("Mes commandes").isVisible()), "S15 : profil et liste des commandes");
  await shot(buyer, "S15");
  await buyer.goto(`${BASE}/members/user-marie`);
  check(await buyer.getByRole("heading", { name: "Marie K." }).isVisible(), "S14 : profil public d'un vendeur");
  await shot(buyer, "S14");

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(log.join("\n"));
  console.log(`\nRéponses API 4xx observées (attendues) : ${apiStatuses.length ? apiStatuses.join(", ") : "aucune"}`);
  console.log(`\n${failures === 0 ? "PARCOURS RÉUSSI" : `ÉCHEC : ${failures} vérification(s)`} (${log.filter((l) => l.startsWith("OK")).length} OK)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.log(log.join("\n"));
  console.error("\nERREUR :", e.message);
  process.exit(1);
});
