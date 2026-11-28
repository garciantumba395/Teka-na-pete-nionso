import { alerts, apiListing, apiOrder, expect, jpegBuffer, file, open, test, uniqueTitle } from "../support";

test.describe("N Réseau", () => {
  test("N-1 latence de 3 s sur Acheter et Payer : boutons inactifs, aucun double envoi", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur réseau");
    const buyer = await makeActor("Acheteur réseau");
    const item = await apiListing(seller.request);
    const posts: string[] = [];
    await buyer.context.route("**/api/v1/orders**", async (route) => {
      if (route.request().method() === "POST") posts.push(new URL(route.request().url()).pathname);
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await open(buyer.page, `/items/${item.id}`);
    const buy = buyer.page.getByRole("button", { name: /^Acheter/ });
    await buy.click();
    await expect(buy).toBeDisabled();
    await expect(buy).toHaveAttribute("aria-busy", "true");
    await buy.click({ timeout: 800, force: true }).catch(() => undefined);
    await expect(buyer.page).toHaveURL(/\/pay$/, { timeout: 15_000 });
    expect(posts.filter((p) => p === "/api/v1/orders")).toHaveLength(1);
    const pay = buyer.page.getByRole("button", { name: /^Payer/ });
    await pay.click();
    await expect(buyer.page.getByText("Valide le paiement sur ton téléphone")).toBeVisible({ timeout: 10_000 });
    expect(posts.filter((p) => p.endsWith("/pay"))).toHaveLength(1);
  });

  test("N-2 hors ligne puis retour en ligne : message clair, saisie conservée, reprise possible", async ({ makeActor }) => {
    const s = await makeActor("Vendeur hors ligne");
    const p = s.page;
    await open(p, "/sell");
    const title = uniqueTitle("Hors ligne");
    await p.locator('input[type="file"]').setInputFiles(file(await jpegBuffer(p, 300, 400)));
    await expect(p.locator(".photos-strip .thumb img")).toHaveCount(1);
    await p.getByLabel("Titre", { exact: true }).fill(title);
    await p.getByLabel("Catégorie", { exact: true }).selectOption({ label: "Robes" });
    await p.getByLabel("État", { exact: true }).selectOption({ label: "Bon état" });
    await p.getByLabel(/^Prix en/).fill("15");
    await s.context.setOffline(true);
    await p.getByRole("button", { name: "Publier l'annonce" }).click();
    await expect(alerts(p).first()).toContainText(/Connexion impossible/);
    expect(await p.getByLabel("Titre", { exact: true }).inputValue(), "la saisie doit être conservée").toBe(title);
    await expect(p.locator(".photos-strip .thumb img")).toHaveCount(1);
    await s.context.setOffline(false);
    await p.getByRole("button", { name: "Publier l'annonce" }).click();
    await expect(p).toHaveURL(/\/items\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    void apiOrder;
  });
});
