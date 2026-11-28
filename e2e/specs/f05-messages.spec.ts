import { alerts, apiListing, expect, open, test, type Actor } from "../support";

async function duo(makeActor: (n?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeuse Chat");
  const buyer = await makeActor("Acheteur Chat");
  const item = await apiListing(seller.request);
  return { seller, buyer, item };
}
const box = (a: Actor) => a.page.getByLabel("Ton message");
const send = (a: Actor) => a.page.getByRole("button", { name: "Envoyer" });
const log = (a: Actor) => a.page.getByRole("log", { name: "Messages" });

test.describe("F05 Messagerie", () => {
  test("F05-H1 poser une question, recevoir la réponse, non lus puis lus", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    await open(buyer.page, `/items/${item.id}`);
    await buyer.page.getByRole("button", { name: "Écrire" }).click();
    await expect(buyer.page).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/);
    await box(buyer).click();
    await buyer.page.keyboard.type("Bonjour, on peut se voir à Gombe demain ?");
    await buyer.page.keyboard.press("Enter");
    await expect(log(buyer).getByText("on peut se voir à Gombe demain")).toBeVisible();
    await expect(box(buyer)).toHaveValue("");

    // la vendeuse voit 1 non lu, ouvre, répond
    await open(seller.page, "/inbox");
    await expect(seller.page.getByLabel("1 non lu")).toBeVisible();
    await seller.page.getByRole("link", { name: /Acheteur Chat/ }).click();
    await expect(log(seller).getByText("on peut se voir à Gombe demain")).toBeVisible();
    await box(seller).click();
    await seller.page.keyboard.type("Oui, 15 h devant la station.");
    await seller.page.keyboard.press("Enter");

    // l'acheteur la reçoit sans recharger (interrogation régulière)
    await expect(log(buyer).getByText("15 h devant la station")).toBeVisible({ timeout: 12_000 });
    // le non lu de la vendeuse est retombé à zéro
    await open(seller.page, "/inbox");
    await expect(seller.page.getByText("1 non lu")).toHaveCount(0);
  });

  test("F05-E1 message vide : bouton inactif ; espaces seuls refusés par l'API", async ({ makeActor }) => {
    const { seller, buyer, item } = await duo(makeActor);
    const c = await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } });
    expect(c.status()).toBe(201);
    const id = (await c.json()).conversation.id;
    await open(buyer.page, `/inbox/${id}`);
    await expect(send(buyer)).toBeDisabled();
    await box(buyer).fill("   ");
    await expect(send(buyer)).toBeDisabled();
    const r = await buyer.request.post(`/api/v1/conversations/${id}/messages`, { data: { body: "   " } });
    expect(r.status()).toBe(422);
    void seller;
  });

  test("F05-E2 un numéro de téléphone ou un lien : message remis avec un rappel de sécurité", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    await open(buyer.page, `/items/${item.id}`);
    await buyer.page.getByRole("button", { name: "Écrire" }).click();
    await box(buyer).fill("Appelle-moi au 082 123 45 67");
    await send(buyer).click();
    await expect(log(buyer).getByText("Appelle-moi au 082 123 45 67")).toBeVisible();
    await expect(log(buyer).getByText(/Ne paie jamais en dehors/)).toBeVisible();
    await box(buyer).fill("Bonjour, simple question");
    await send(buyer).click();
    await expect(log(buyer).getByText("Bonjour, simple question")).toBeVisible();
    await expect(log(buyer).getByText(/Ne paie jamais en dehors/)).toHaveCount(1);
  });

  test("F05-E3 message de 2 001 caractères : champ limité à 2 000 ; API 422", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const id = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    await open(buyer.page, `/inbox/${id}`);
    await box(buyer).fill("é".repeat(2001));
    expect((await box(buyer).inputValue()).length).toBe(2000);
    const r = await buyer.request.post(`/api/v1/conversations/${id}/messages`, { data: { body: "é".repeat(2001) } });
    expect(r.status()).toBe(422);
    const ok = await buyer.request.post(`/api/v1/conversations/${id}/messages`, { data: { body: "é".repeat(2000) } });
    expect(ok.status()).toBe(201);
  });

  test("F05-E4 double-clic sur Écrire : une seule conversation", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    await open(buyer.page, `/items/${item.id}`);
    await buyer.page.getByRole("button", { name: "Écrire" }).dblclick();
    await expect(buyer.page).toHaveURL(/\/inbox\/[0-9a-f-]{36}$/);
    const list = await (await buyer.request.get("/api/v1/conversations")).json();
    expect(list.conversations).toHaveLength(1);
    // et la deuxième demande retrouve la même conversation (200, pas 201)
    const again = await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } });
    expect(again.status()).toBe(200);
    expect((await again.json()).conversation.id).toBe(list.conversations[0].id);
  });

  test("F05-E5 sa propre annonce : pas de bouton, l'API refuse (409)", async ({ makeActor }) => {
    const { seller, item } = await duo(makeActor);
    await open(seller.page, `/items/${item.id}`);
    await expect(seller.page.getByRole("button", { name: "Écrire" })).toHaveCount(0);
    const r = await seller.request.post("/api/v1/conversations", { data: { itemId: item.id } });
    expect(r.status()).toBe(409);
  });

  test("F05-E6 HTML et script dans un message : affichés comme du texte", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const id = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    const payload = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;
    await buyer.request.post(`/api/v1/conversations/${id}/messages`, { data: { body: payload } });
    await open(buyer.page, `/inbox/${id}`);
    await expect(log(buyer).getByText(payload)).toBeVisible();
    expect(await buyer.page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("F05-E7 60 messages en 10 minutes : 429 au-delà de 40", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    const id = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    const codes: number[] = [];
    for (let i = 0; i < 44; i++) codes.push((await buyer.request.post(`/api/v1/conversations/${id}/messages`, { data: { body: `m${i}` } })).status());
    expect(codes.filter((c) => c === 201)).toHaveLength(40);
    expect(codes.filter((c) => c === 429)).toHaveLength(4);
  });

  test("F05-E8 une conversation vide s'affiche avec une invitation, la liste vide aussi", async ({ makeActor }) => {
    const { buyer, item } = await duo(makeActor);
    await open(buyer.page, "/inbox");
    await expect(buyer.page.getByText("Aucune conversation")).toBeVisible();
    const id = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    await open(buyer.page, `/inbox/${id}`);
    await expect(buyer.page.getByText(/Aucun message pour l'instant/)).toBeVisible();
    expect(await alerts(buyer.page).count()).toBe(0);
  });

  test("F05-N1 un tiers : 404 sur la page et l'API ; sans session : 307 vers la connexion", async ({ makeActor, request }) => {
    const { buyer, item } = await duo(makeActor);
    const tiers = await makeActor("Tiers Curieux");
    const id = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id;
    await buyer.request.post(`/api/v1/conversations/${id}/messages`, { data: { body: "privé" } });
    expect((await tiers.request.get(`/api/v1/conversations/${id}`)).status()).toBe(404);
    expect((await tiers.request.post(`/api/v1/conversations/${id}/messages`, { data: { body: "intrus" } })).status()).toBe(404);
    const page = await tiers.page.goto(`/inbox/${id}`);
    expect(page?.status()).toBe(404);
    expect((await tiers.request.get("/api/v1/conversations")).status()).toBe(200);
    expect((await (await tiers.request.get("/api/v1/conversations")).json()).conversations).toEqual([]);
    const anon = await request.get("/inbox", { maxRedirects: 0 });
    expect(anon.status()).toBe(307);
    expect(anon.headers().location).toMatch(/\/signin\?next=(%2F|\/)inbox/);
    expect((await request.get("/api/v1/conversations")).status()).toBe(401);
    expect((await request.get("/inbox/pas-un-uuid", { maxRedirects: 0 })).status()).toBeGreaterThanOrEqual(307);
  });
});
