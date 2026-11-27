import { apiBuyAndPay, apiListing, expect, open, test } from "../support";

// Flux non construits : on vérifie seulement que l'écran répond proprement et le dit honnêtement.
// Ces tests NE comptent PAS comme « fonction réussie » : voir replica/test-plan.md.
test.describe("F03 à F08 : écrans en attente", () => {
  test("F03-G1 « J'ai un problème » arrive sur un écran qui dit « Bientôt disponible »", async ({ makeActor }) => {
    const seller = await makeActor("Vendeur litige");
    const buyer = await makeActor("Acheteur litige");
    const orderId = await apiBuyAndPay(buyer.request, (await apiListing(seller.request)).id);
    await open(buyer.page, `/orders/${orderId}`);
    await buyer.page.getByRole("link", { name: "J'ai un problème" }).click();
    await expect(buyer.page).toHaveURL(new RegExp(`/orders/${orderId}/dispute$`));
    await expect(buyer.page.getByText("Bientôt disponible")).toBeVisible();
  });

  for (const [id, path] of [["F03-G2", "dispute"], ["F06-G1", "review"]] as const) {
    test(`${id} /orders/…/${path} répond 200 avec « Bientôt disponible »`, async ({ makeActor }) => {
      const a = await makeActor("Membre");
      const res = await open(a.page, `/orders/00000000-0000-4000-8000-000000000001/${path}`);
      expect(res?.status()).toBe(200);
      await expect(a.page.getByText("Bientôt disponible")).toBeVisible();
    });
  }

  for (const [id, path] of [["F05-G1", "/inbox"], ["F07-G1", "/pro"], ["F08-G1", "/report"]] as const) {
    test(`${id} ${path} répond 200 avec « Bientôt disponible »`, async ({ page }) => {
      const res = await open(page, path);
      expect(res?.status()).toBe(200);
      await expect(page.getByText("Bientôt disponible")).toBeVisible();
      await expect(page.getByRole("link", { name: "Retour à l'accueil" })).toBeVisible();
    });
  }
});
