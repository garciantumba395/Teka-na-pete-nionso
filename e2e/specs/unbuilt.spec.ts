import { expect, open, test } from "../support";

// Flux non construits : on vérifie seulement que l'écran répond proprement et le dit honnêtement.
// Ces tests NE comptent PAS comme « fonction réussie » : voir replica/test-plan.md.
test.describe("F07 : écrans en attente", () => {
  test("F07-G1 /pro répond 200 avec « Bientôt disponible »", async ({ page }) => {
    const res = await open(page, "/pro");
    expect(res?.status()).toBe(200);
    await expect(page.getByText("Bientôt disponible")).toBeVisible();
    await expect(page.getByRole("link", { name: "Retour à l'accueil" })).toBeVisible();
  });
});
