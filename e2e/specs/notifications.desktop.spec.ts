import { apiListing, expect, noHorizontalScroll, open, test } from "../support";

test("N-10d bureau : lien Notifications avec pastille dans la navigation du haut, sans erreur d'hydratation", async ({ makeActor, browser, baseURL }) => {
  const seller = await makeActor("Vendeuse bureau");
  const buyer = await makeActor("Acheteur bureau");
  const item = await apiListing(seller.request);
  await seller.page.setViewportSize({ width: 1440, height: 900 });
  await open(seller.page, "/");
  const link = seller.page.locator(".topnav").getByRole("link", { name: /^Notifications/ });
  await expect(link).toBeVisible();
  await expect(link).toHaveAccessibleName("Notifications");

  const c = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
  await buyer.request.post(`/api/v1/conversations/${c}/messages`, { data: { body: "Bonjour" } });
  for (const url of ["/", "/search", "/notifications", "/me"]) {
    await open(seller.page, url);
    await expect(seller.page.locator(".topnav").getByRole("link", { name: /^Notifications ?, 1 notification non lue$/ })).toBeVisible();
    expect(await noHorizontalScroll(seller.page), url).toBe(true);
  }
  await seller.page.locator(".topnav").getByRole("link", { name: /^Notifications/ }).click();
  await expect(seller.page).toHaveURL(/\/notifications$/);
  await expect(seller.page.locator(".topnav").getByRole("link", { name: /^Notifications/ })).toHaveAttribute("aria-current", "page");

  // visiteur : pas de lien Notifications
  const visitor = await browser.newContext({ baseURL: baseURL ?? undefined, viewport: { width: 1440, height: 900 } });
  const p = await visitor.newPage();
  await p.goto("/");
  await expect(p.locator(".topnav").getByRole("link", { name: /^Notifications/ })).toHaveCount(0);
  await visitor.close();
});
