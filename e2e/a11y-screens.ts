import { writeFileSync } from "node:fs";
import { ID, PHOTO, adminPhone, apiBuyAndPay, apiCode, apiListing, apiOrder, apiPay, expect, noHorizontalScroll, open, scan, staffPhone, test, uniquePhone, waitForStatus, type A11yIssue } from "./support";

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
      await check("404", page, "/items/inexistant");
      await check("Articles interdits (page publique)", page, "/legal/articles-interdits");
      await check("Hors ligne (/offline)", page, "/offline");
      // acheteur connecté
      const bp = buyer.page;
      await check("S05 vente (vide)", bp, "/sell");
      await check("S05 vente (erreurs)", bp, "/sell", async () => { await bp.getByRole("button", { name: "Publier l'annonce" }).click(); await bp.locator(".error[role=alert]").first().waitFor(); });
      await check("S08 paiement", bp, `/orders/${pendingId}/pay`);
      await check("S09 commande payée (acheteur, code affiché)", bp, `/orders/${paidId}`, async () => { await bp.getByRole("button", { name: "Afficher mon code" }).click(); await bp.getByRole("img", { name: /Code de remise/ }).waitFor(); });
      await check("S09 commande payée (acheteur, confirmation de demande d'annulation)", bp, `/orders/${paidId}`, async () => { await bp.getByRole("button", { name: "Demander l'annulation" }).click(); await bp.getByRole("alertdialog").waitFor(); });
      expect((await buyer.request.post(`/api/v1/orders/${paidId}/cancel-request`, { data: {} })).status()).toBe(200);
      await check("S09 commande payée (acheteur, demande d'annulation envoyée)", bp, `/orders/${paidId}`);
      await check("S09 commande en attente de paiement", bp, `/orders/${pendingId}`);
      await check("S15 mon profil", bp, "/me");
      await check("S16 portefeuille vide", bp, "/wallet");
      await check("S14 profil public", bp, `/members/${seller.userId}`);
      await check("S07 messages (vide)", bp, "/inbox");
      const conv = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
      await buyer.request.post(`/api/v1/conversations/${conv}/messages`, { data: { body: "Bonjour, 0821234567 pour discuter" } });
      await check("S07 messages (liste)", bp, "/inbox");
      await check("S07 conversation (avec rappel de sécurité)", bp, `/inbox/${conv}`);
      await check("S11 litige : formulaire", bp, `/orders/${paidId}/dispute`);
      await check("S19 signalement", bp, `/report?type=item&id=${item.id}`);
      await check("S03 recherche avec marque, taille et état", bp, "/search?brand=zephyr&size=M&condition=good&condition=new");
      await check("S21 notifications (vide)", bp, "/notifications"); // agent C
      await check("S22 réglages des notifications", bp, "/me/notifications"); // agent C
      // ---- agent J : lots (panier)
      await check("Panier (vide)", bp, "/cart");
      const lotA = await apiListing(seller.request, { priceMinor: 2000 });
      const lotB = await apiListing(seller.request, { priceMinor: 1500 });
      await buyer.request.post("/api/v1/cart", { data: { itemId: lotA.id } });
      await buyer.request.post("/api/v1/cart", { data: { itemId: lotB.id } });
      await check("Fiche article avec « Ajouter au panier » (acheteur connecté)", bp, `/items/${lotA.id}`);
      await check("Panier (lot de deux articles)", bp, "/cart");
      await check("Panier (lot, choix de livraison ouvert)", bp, "/cart", async () => { await bp.getByRole("button", { name: /^Commander le lot/ }).click(); await bp.getByRole("button", { name: "Confirmer la commande du lot" }).waitFor(); });
      await check("Profil public avec « Ajouter au panier »", bp, `/members/${seller.userId}`);
      await buyer.request.post("/api/v1/cart/remove", { data: { itemId: lotA.id } });
      await buyer.request.post("/api/v1/cart/remove", { data: { itemId: lotB.id } });
      // ---- fin agent J
      // agent H : découverte (cartes avec cœur, favoris, préférences, « Pour toi », tri)
      await check("S01 accueil, cartes avec cœur (visiteur)", page, "/");
      await check("S17 favoris (vide)", bp, "/favourites");
      expect((await buyer.request.post("/api/v1/favourites", { data: { itemId: item.id } })).status()).toBe(200);
      await check("S17 favoris (une annonce)", bp, "/favourites");
      await check("S17 fiche article avec cœur pressé (acheteur)", bp, `/items/${item.id}`);
      await check("S01 accueil, invitation « Pour toi » (membre)", bp, "/");
      await check("S23 préférences : marques et tailles (vide)", bp, "/me/preferences");
      expect((await buyer.request.post("/api/v1/me/follows", { data: { kind: "brand", value: "Zephyr" } })).status()).toBe(200);
      expect((await buyer.request.post("/api/v1/me/follows", { data: { kind: "size", value: "M" } })).status()).toBe(200);
      await check("S23 préférences : marques et tailles (suivies)", bp, "/me/preferences");
      await check("S01 accueil, section « Pour toi » (membre)", bp, "/");
      await check("S03 recherche triée (prix décroissant, puce du tri)", bp, "/search?q=robe&sort=price_desc");
      // vendeur
      const sp = seller.page;
      await check("S09 commande payée (vendeur, demande d'annulation à traiter + saisie du code)", sp, `/orders/${paidId}`);
      await check("S09 commande payée (vendeur, confirmation d'acceptation)", sp, `/orders/${paidId}`, async () => { await sp.getByRole("button", { name: "Accepter l'annulation" }).click(); await sp.getByRole("alertdialog").first().waitFor(); });
      await check("S04 fiche (propriétaire)", sp, `/items/${item.id}`);
      await check("S21 notifications (liste, avec pastille de non-lus)", sp, "/notifications"); // agent C : le vendeur a un message non lu et une commande payée
      await check("S15 mon profil (avec pastille de non-lus)", sp, "/me"); // agent C
      await sp.request.post(`/api/v1/orders/${paidId}/confirm-delivery`, { data: { code } });
      await check("S16 portefeuille (avec solde)", sp, "/wallet");

      // photos de messages et de preuves (litige ouvert sur une troisième commande : la deuxième sert à la remise ci-dessus)
      await buyer.request.post(`/api/v1/conversations/${conv}/messages`, { data: { body: "Voici une photo", photo: PHOTO } });
      await check("S07 conversation (photo envoyée)", bp, `/inbox/${conv}`);
      await check("S07 photo agrandie", bp, `/inbox/${conv}`, async () => { await bp.getByRole("button", { name: /Agrandir : Photo envoyée par/ }).first().click(); await bp.getByRole("dialog").waitFor(); });
      const item3 = await apiListing(seller.request);
      const disputedId = await apiBuyAndPay(buyer.request, item3.id);
      const dsp = await buyer.request.post(`/api/v1/orders/${disputedId}/dispute`, { data: { reason: "damaged", description: "L'article est abîmé, voir les photos." } });
      const disputeId = (await dsp.json()).dispute.id as string;
      await buyer.request.post(`/api/v1/disputes/${disputeId}/evidence`, { data: { photo: PHOTO, note: "Le col est déchiré" } });
      await check("S11 litige : preuves (membre, ajout possible)", bp, `/orders/${disputedId}/dispute`);
      await check("S11 litige : photo de preuve avec aperçu avant envoi", bp, `/orders/${disputedId}/dispute`, async () => {
        const buf = Buffer.from(PHOTO.split(",")[1], "base64");
        await bp.getByLabel("Choisir une photo").setInputFiles({ name: "p.jpg", mimeType: "image/jpeg", buffer: buf });
        await bp.getByRole("alert").filter({ hasText: "n'a pas pu être lue" }).waitFor(); // l'image minimale n'est pas décodable : l'erreur s'affiche
      });
      const staff = await makeActor("Assistance access", staffPhone());
      const admin = await makeActor("Admin access", adminPhone()); // agent G
      await check("S12 assistance : litige avec preuves", staff.page, `/staff/disputes/${disputeId}`);
      await check("Frais de livraison à régler (assistance)", staff.page, "/staff/courier-fees"); // agent G
      await check("Frais de livraison à régler (administrateur : réglage du mode)", admin.page, "/staff/courier-fees"); // agent G
      // on clôt ce litige : la file de l'assistance doit rester vide pour les tests qui la parcourent
      expect((await staff.request.post(`/api/v1/staff/disputes/${disputeId}/resolve`, { data: { outcome: "refund_buyer" } })).status()).toBe(200);

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
      const screens: [typeof page, string][] = [[page, "/"], [page, "/search"], [page, "/signin"], [page, `/items/${item.id}`], [buyer.page, "/sell"], [buyer.page, `/orders/${orderId}`], [buyer.page, "/wallet"], [buyer.page, "/me"], [buyer.page, `/members/${seller.userId}`], [page, "/inbox"], [buyer.page, "/favourites"], [buyer.page, "/me/preferences"], [buyer.page, "/"], [page, "/search?sort=price_asc"]];
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

    // ---- agent D : écrans de la livraison par coursier (choix à l'achat, expédition, suivi, réception, litige après livraison)
    test(`X-5 analyse axe des écrans de livraison par coursier (${label})`, async ({ makeActor }) => {
      test.setTimeout(180_000);
      const seller = await makeActor("Vendeur coursier access");
      const buyer = await makeActor("Acheteur coursier access");
      const found: { screen: string; issues: A11yIssue[] }[] = [];
      const check = async (screen: string, p: typeof buyer.page, url: string, prep?: () => Promise<void>) => {
        await open(p, url);
        if (prep) await prep();
        found.push({ screen, issues: await scan(p) });
      };
      const order = async (itemId: string) => {
        const r = await buyer.request.post("/api/v1/orders", { data: { itemIds: [itemId], deliveryMethod: "courier", deliveryAreaId: ID.areaLimete, deliveryLandmark: "Avenue de la Paix, portail bleu" } });
        expect(r.status()).toBe(201);
        return (await r.json()).order.id as string;
      };
      const pay = async (id: string) => { expect((await apiPay(buyer.request, id, "0821111111")).status()).toBe(202); await waitForStatus(buyer.request, id, "paid"); };
      const act = async (a: typeof seller, id: string, path: string, data: unknown = {}) => expect((await a.request.post(`/api/v1/orders/${id}/${path}`, { data })).status()).toBe(200);

      const item1 = await apiListing(seller.request);
      await check("S04 fiche article : choix de livraison par coursier", buyer.page, `/items/${item1.id}`, async () => {
        await buyer.page.getByRole("radio", { name: /Livraison par coursier/ }).check();
        await buyer.page.getByLabel("Ta commune").selectOption(ID.areaLimete);
        await buyer.page.getByLabel("Repère pour le coursier").fill("Avenue de la Paix");
        await buyer.page.getByRole("status").filter({ hasText: "Livraison :" }).waitFor();
      });
      await check("S04 fiche article : coursier sans commune (erreur)", buyer.page, `/items/${item1.id}`, async () => {
        await buyer.page.getByRole("radio", { name: /Livraison par coursier/ }).check();
        await buyer.page.getByRole("button", { name: /^Acheter/ }).click();
        await buyer.page.locator("#buy-err").waitFor();
      });
      const id1 = await order(item1.id);
      await check("S08 paiement (livraison par coursier)", buyer.page, `/orders/${id1}/pay`);
      await pay(id1);
      await check("S09 commande payée (acheteur, coursier)", buyer.page, `/orders/${id1}`);
      await check("S09 commande payée (vendeur) : formulaire Expédier", seller.page, `/orders/${id1}`);
      await check("S09 formulaire Expédier avec erreurs", seller.page, `/orders/${id1}`, async () => {
        await seller.page.getByRole("button", { name: "Marquer comme remis au coursier" }).click();
        await seller.page.locator(".error[role=alert]").first().waitFor();
      });
      await act(seller, id1, "ship", { courierName: "Papy Moto", courierPhone: "0899000111", trackingRef: "MOTO-42" });
      await check("S09 colis remis au coursier (vendeur)", seller.page, `/orders/${id1}`);
      await check("S09 colis remis au coursier (acheteur) : coursier et historique", buyer.page, `/orders/${id1}`);
      await check("S09 colis non reçu : confirmation", buyer.page, `/orders/${id1}`, async () => {
        await buyer.page.getByRole("button", { name: "Colis non reçu" }).click();
        await buyer.page.getByRole("alertdialog").waitFor();
      });
      await act(seller, id1, "in-transit");
      await act(buyer, id1, "received");
      await check("S09 colis reçu (acheteur) : accepter ou signaler", buyer.page, `/orders/${id1}`);
      await check("S09 colis reçu (vendeur) : attente de libération", seller.page, `/orders/${id1}`);
      await check("S11 litige après livraison : formulaire", buyer.page, `/orders/${id1}/dispute`);

      const flat = found.flatMap((f) => f.issues.map((i) => ({ screen: f.screen, ...i })));
      const blocking = flat.filter((i) => i.impact === "serious" || i.impact === "critical");
      console.log(`[a11y courier ${label}] ${found.length} écrans, ${flat.length} violations (${blocking.length} graves ou critiques)`);
      for (const b of blocking) expect.soft(b, `${b.screen} : ${b.id} (${b.impact}) ${b.help}`).toBeUndefined();
    });
  });
}
