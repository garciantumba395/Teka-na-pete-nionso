import { apiListing, expect, noHorizontalScroll, open, test } from "../support";

test("X-5d bureau : navigation du haut visible, barre d'onglets masquée, pas de débordement", async ({ makeActor }) => {
  const s = await makeActor("Vendeur bureau");
  const item = await apiListing(s.request);
  await s.page.setViewportSize({ width: 1440, height: 900 });
  for (const url of ["/", "/search", `/items/${item.id}`, "/sell", "/wallet", "/me"]) {
    await open(s.page, url);
    await expect(s.page.locator(".topnav")).toBeVisible();
    await expect(s.page.locator(".tabbar-fixed")).toBeHidden();
    expect(await noHorizontalScroll(s.page), url).toBe(true);
  }
});
