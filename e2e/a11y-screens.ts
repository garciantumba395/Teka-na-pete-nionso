import { writeFileSync } from "node:fs";
import { apiBuyAndPay, apiCode, apiListing, apiOrder, expect, noHorizontalScroll, open, scan, test, uniquePhone, type A11yIssue } from "./support";

/** Écrans à analyser : un parcours complet crée les données nécessaires. */
export function defineA11y(label: string) {
  test.describe(`X Accessibilité (${label})`, () => {
    test(`X-1 analyse axe de chaque écran (${label})`, async ({ makeActor, page }) => {
      test.setTimeout(180_000);
      const seller = await makeActor("Vendeur access");
      const buyer = await makeActor("Acheteur access");
      const item = await apiListing(seller.request, { priceMinor: 2500 });
      const pendingId = await apiOrder(buyer.request, item.id);
      const item2 = await apiListing(seller.request);
      const paidId = await apiBuyAndPay(buyer.request, item2.id);
      const code = await apiCode(buyer.request, paidId);
      const found: { screen: string; issues: A11yIssue[] }[] = [];
      const check = async (screen: string, p: typeof page, url: string, prep?: () => Promise<void>) => {
        await open(p, url);
        if (prep) await prep();
        found.push({ screen, issues: await scan(p) });
      };

      // public
      await check("S01 accueil", page, "/");
      await check("S03 recherche", page, "/search");
      await check("S03 recherche avec filtres", page, "/search?q=robe&max=50");
      await check("S03 recherche sans résultat", page, "/search?q=zzzzzzzz-introuvable");
      await check("S04 fiche article (visiteur)", page, `/items/${item.id}`);
      await check("S02 connexion, étape numéro", page, "/signin");
      await check("S02 connexion, étape code", page, "/signin", async () => {
        await page.keyboard.type(uniquePhone(), { delay: 10 });
        await page.keyboard.press("Enter");
        await page.getByText("Code reçu par SMS").waitFor();
      });
      await check("S07 écran en attente", page, "/inbox");
      await check("404", page, "/items/inexistant");
      // acheteur connecté
      const bp = buyer.page;
      await check("S05 vente (vide)", bp, "/sell");
      await check("S05 vente (erreurs)", bp, "/sell", async () => { await bp.getByRole("button", { name: "Publier l'annonce" }).click(); await bp.locator(".error[role=alert]").first().waitFor(); });
      await check("S08 paiement", bp, `/orders/${pendingId}/pay`);
      await check("S09 commande payée (acheteur, code affiché)", bp, `/orders/${paidId}`, async () => { await bp.getByRole("button", { name: "Afficher mon code" }).click(); await bp.getByRole("img", { name: /Code de remise/ }).waitFor(); });
      await check("S09 commande en attente de paiement", bp, `/orders/${pendingId}`);
      await check("S15 mon profil", bp, "/me");
      await check("S16 portefeuille vide", bp, "/wallet");
      await check("S14 profil public", bp, `/members/${seller.userId}`);
      // vendeur
      const sp = seller.page;
      await check("S09 commande payée (vendeur, saisie du code)", sp, `/orders/${paidId}`);
      await check("S04 fiche (propriétaire)", sp, `/items/${item.id}`);
      await sp.request.post(`/api/v1/orders/${paidId}/confirm-delivery`, { data: { code } });
      await check("S16 portefeuille (avec solde)", sp, "/wallet");

      const flat = found.flatMap((f) => f.issues.map((i) => ({ screen: f.screen, ...i })));
      writeFileSync(`test-results/a11y-${label}.json`, JSON.stringify(flat, null, 2));
      const blocking = flat.filter((i) => i.impact === "serious" || i.impact === "critical");
      console.log(`[a11y ${label}] ${found.length} écrans, ${flat.length} violations (${blocking.length} graves ou critiques)`);
      for (const b of blocking) expect.soft(b, `${b.screen} : ${b.id} (${b.impact}) ${b.help}`).toBeUndefined();
    });

    test(`X-2 clavier seul : lien d'évitement, ordre de tabulation, focus visible (${label})`, async ({ page }) => {
      await open(page, "/");
      await page.getByRole("heading", { level: 1 }).waitFor(); // le contenu diffusé en continu doit être arrivé : sinon on tabule dans le squelette
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.textContent), "premier arrêt de tabulation").toContain("Aller au contenu");
      const visibleSkip = await page.evaluate(() => { const r = document.activeElement!.getBoundingClientRect(); return r.top >= 0 && r.height > 0; });
      expect(visibleSkip, "le lien d'évitement doit devenir visible au focus").toBe(true);
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => location.hash === "#main"); // la navigation vers l'ancre doit être terminée avant de continuer
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("main")), "après le lien d'évitement, le focus doit entrer dans le contenu").toBe(true);
      const bad: string[] = [];
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const cs = getComputedStyle(el);
          const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
          return { ring, label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40) };
        });
        if (!r.ring) bad.push(r.label);
      }
      expect(bad, "éléments focalisés sans indicateur visible").toEqual([]);
    });

    test(`X-3 largeur 320 px : aucun écran ne déborde (${label})`, async ({ makeActor, page }) => {
      test.skip(label !== "mobile", "contrôle fait une seule fois, sur le projet mobile");
      const seller = await makeActor("Vendeur 320");
      const buyer = await makeActor("Acheteur 320");
      const item = await apiListing(seller.request, { title: "Un titre assez long pour vérifier qu'il passe à la ligne sans casser", description: "mot ".repeat(200) });
      const orderId = await apiBuyAndPay(buyer.request, item.id);
      await buyer.page.setViewportSize({ width: 320, height: 640 });
      await page.setViewportSize({ width: 320, height: 640 });
      const screens: [typeof page, string][] = [[page, "/"], [page, "/search"], [page, "/signin"], [page, `/items/${item.id}`], [buyer.page, "/sell"], [buyer.page, `/orders/${orderId}`], [buyer.page, "/wallet"], [buyer.page, "/me"], [buyer.page, `/members/${seller.userId}`], [page, "/inbox"]];
      const over: string[] = [];
      for (const [p, url] of screens) { await open(p, url); if (!(await noHorizontalScroll(p))) over.push(url); }
      expect(over, "écrans qui débordent à 320 px").toEqual([]);
    });

    test(`X-4 prefers-reduced-motion : animations coupées (${label})`, async ({ makeActor, page }) => {
      test.skip(label !== "mobile", "contrôle fait une seule fois, sur le projet mobile");
      const seller = await makeActor("Vendeur motion");
      const buyer = await makeActor("Acheteur motion");
      const item = await apiListing(seller.request);
      const orderId = await apiOrder(buyer.request, item.id);
      await buyer.page.emulateMedia({ reducedMotion: "reduce" });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(buyer.page, `/orders/${orderId}/pay`);
      await buyer.page.getByRole("button", { name: /^Payer/ }).click();
      await buyer.page.locator(".pulse").waitFor();
      expect(await buyer.page.locator(".pulse").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
      await buyer.page.context().route("**/api/v1/items**", (r) => new Promise((res) => setTimeout(res, 800)).then(() => r.continue()));
      await open(page, "/");
      const names = await page.locator(".skeleton").evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName));
      expect(names.every((n) => n === "none")).toBe(true);
    });
  });
}
