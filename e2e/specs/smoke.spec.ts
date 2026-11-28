import { apiListing, expect, open, test } from "../support";

test("infrastructure : un membre, une annonce, la fiche s'affiche", async ({ makeActor }) => {
  const seller = await makeActor("Vendeur Fumée");
  const item = await apiListing(seller.request);
  await open(seller.page, `/items/${item.id}`);
  await expect(seller.page.getByRole("heading", { name: item.title })).toBeVisible();
});
