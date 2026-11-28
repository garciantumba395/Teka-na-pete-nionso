import { alerts, apiBuyAndPay, apiListing, expect, file, jpegBuffer, open, PHOTO, randomIp, signUp, staffPhone, test, type Actor } from "../support";
import type { APIRequestContext, Locator } from "@playwright/test";

// Photos jointes aux messages et aux preuves de litige : envoi, affichage, contrôle d'accès, refus des faux fichiers.

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString("base64")}`;
const DISGUISED = `data:image/jpeg;base64,${Buffer.from("ceci est un fichier texte, pas une image").toString("base64")}`;
const TOO_BIG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(460_000, 1)]).toString("base64")}`;

async function duo(makeActor: (n?: string, p?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeuse Photo");
  const buyer = await makeActor("Acheteur Photo");
  const item = await apiListing(seller.request);
  const conv = (await (await buyer.request.post("/api/v1/conversations", { data: { itemId: item.id } })).json()).conversation.id as string;
  return { seller, buyer, item, conv };
}
// Litiges ouverts par ces tests : clos à la fin de chacun, pour ne pas encombrer la file de l'assistance que d'autres tests parcourent.
const opened: string[] = [];
let cleaner: Promise<APIRequestContext> | null = null; // une seule connexion de l'assistance par processus (les envois de code sont limités)
test.afterEach(async ({ playwright }) => {
  const ids = opened.splice(0);
  if (ids.length === 0) return;
  cleaner ??= (async () => {
    const c = await playwright.request.newContext({ baseURL: process.env.BASE_URL ?? "http://localhost:3100", extraHTTPHeaders: { "x-forwarded-for": randomIp() } });
    await signUp(c, staffPhone(), "Assistance nettoyage");
    return c;
  })();
  const ctx = await cleaner;
  for (const id of ids) await ctx.post(`/api/v1/staff/disputes/${id}/resolve`, { data: { outcome: "refund_buyer" } });
});

async function disputed(makeActor: (n?: string, p?: string) => Promise<Actor>) {
  const seller = await makeActor("Vendeur Preuve");
  const buyer = await makeActor("Acheteur Preuve");
  const item = await apiListing(seller.request);
  const orderId = await apiBuyAndPay(buyer.request, item.id);
  const r = await buyer.request.post(`/api/v1/orders/${orderId}/dispute`, { data: { reason: "not_as_described", description: "La robe est abîmée au niveau du col." } });
  expect(r.status()).toBe(201);
  const disputeId = (await r.json()).dispute.id as string;
  opened.push(disputeId);
  return { seller, buyer, orderId, disputeId };
}
const sendPhoto = (a: Actor, conv: string, data: Record<string, unknown>) => a.request.post(`/api/v1/conversations/${conv}/messages`, { data });
const addEvidence = (a: Actor, disputeId: string, data: Record<string, unknown>) => a.request.post(`/api/v1/disputes/${disputeId}/evidence`, { data });
const loaded = (img: Locator) => expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

test.describe("Photos de messages et de preuves", () => {
  test("B-H1 une photo avec un texte dans un message : aperçu, envoi, vue par l'autre partie, agrandissement", async ({ makeActor }) => {
    const { seller, buyer, conv } = await duo(makeActor);
    await open(buyer.page, `/inbox/${conv}`);
    const send = buyer.page.getByRole("button", { name: "Envoyer" });
    await expect(send).toBeDisabled();
    await buyer.page.getByLabel("Choisir une photo").setInputFiles(file(await jpegBuffer(buyer.page)));
    await expect(buyer.page.getByRole("img", { name: "Aperçu de la photo à envoyer" })).toBeVisible();
    await expect(send).toBeEnabled(); // une photo seule suffit
    // retrait possible avant l'envoi
    await buyer.page.getByRole("button", { name: "Retirer la photo" }).click();
    await expect(buyer.page.getByRole("img", { name: "Aperçu de la photo à envoyer" })).toHaveCount(0);
    await expect(send).toBeDisabled();

    await buyer.page.getByLabel("Choisir une photo").setInputFiles(file(await jpegBuffer(buyer.page)));
    await buyer.page.getByLabel("Ton message").fill("Voilà la tache sur la manche");
    await send.click();
    const mine = buyer.page.getByRole("log", { name: "Messages" }).getByRole("img", { name: "Photo envoyée par Acheteur Photo" });
    await expect(mine).toBeVisible();
    await loaded(mine);
    await expect(buyer.page.getByText("Voilà la tache sur la manche")).toBeVisible();
    await expect(buyer.page.getByRole("img", { name: "Aperçu de la photo à envoyer" })).toHaveCount(0);

    // l'autre partie la voit (liste des conversations : « Photo » ou le texte), puis l'agrandit
    await open(seller.page, `/inbox/${conv}`);
    const theirs = seller.page.getByRole("log", { name: "Messages" }).getByRole("img", { name: "Photo envoyée par Acheteur Photo" });
    await expect(theirs).toBeVisible();
    await loaded(theirs);
    await seller.page.getByRole("button", { name: /Agrandir : Photo envoyée par Acheteur Photo/ }).click();
    const dialog = seller.page.getByRole("dialog");
    await expect(dialog.getByRole("img", { name: "Photo envoyée par Acheteur Photo" })).toBeVisible();
    await seller.page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("B-H2 au clavier : le bouton Joindre une photo ouvre le sélecteur ; photo seule, sans texte", async ({ makeActor }) => {
    const { seller, buyer, conv } = await duo(makeActor);
    await open(buyer.page, `/inbox/${conv}`);
    const attach = buyer.page.getByRole("button", { name: "Joindre une photo" });
    await expect(attach).toBeEnabled(); // inactif tant que le composant n'est pas hydraté : focus() et Entrée seraient ignorés
    await attach.focus();
    const [chooser] = await Promise.all([buyer.page.waitForEvent("filechooser"), buyer.page.keyboard.press("Enter")]);
    await chooser.setFiles(file(await jpegBuffer(buyer.page, 400, 300)));
    await expect(buyer.page.getByRole("img", { name: "Aperçu de la photo à envoyer" })).toBeVisible();
    await buyer.page.getByRole("button", { name: "Envoyer" }).click();
    await expect(buyer.page.getByRole("log", { name: "Messages" }).getByRole("img", { name: "Photo envoyée par Acheteur Photo" })).toBeVisible();
    // la liste de la vendeuse annonce « Photo » comme dernier message
    await open(seller.page, "/inbox");
    await expect(seller.page.getByText("Photo", { exact: true })).toBeVisible();
  });

  test("B-H3 preuve dans un litige : ajoutée par l'acheteur, vue par le vendeur puis par l'assistance", async ({ makeActor }) => {
    const { seller, buyer, orderId, disputeId } = await disputed(makeActor);
    await open(buyer.page, `/orders/${orderId}/dispute`);
    await expect(buyer.page.getByRole("heading", { name: "Preuves" })).toBeVisible();
    await expect(buyer.page.getByText("Aucune photo pour l'instant.")).toBeVisible();
    const submit = buyer.page.getByRole("button", { name: "Ajouter la preuve" });
    await expect(submit).toBeDisabled();
    await buyer.page.getByLabel("Choisir une photo").setInputFiles(file(await jpegBuffer(buyer.page)));
    await buyer.page.getByLabel("Note sur cette photo (facultatif)").fill("Le col est déchiré");
    await submit.click();
    const photo = buyer.page.getByRole("img", { name: "Photo de preuve ajoutée par Acheteur Preuve" });
    await expect(photo).toBeVisible();
    await loaded(photo);
    await expect(buyer.page.getByText("Le col est déchiré")).toBeVisible();
    await expect(buyer.page.getByText("1/6 photos")).toBeVisible();

    await open(seller.page, `/orders/${orderId}/dispute`);
    const seen = seller.page.getByRole("img", { name: "Photo de preuve ajoutée par Acheteur Preuve" });
    await expect(seen).toBeVisible();
    await loaded(seen);
    await expect(seller.page.getByText("Le col est déchiré")).toBeVisible();
    // le vendeur ajoute la sienne
    await seller.page.getByLabel("Choisir une photo").setInputFiles(file(await jpegBuffer(seller.page, 600, 600)));
    await seller.page.getByRole("button", { name: "Ajouter la preuve" }).click();
    await expect(seller.page.getByRole("img", { name: "Photo de preuve ajoutée par Vendeur Preuve" })).toBeVisible();

    const staff = await makeActor("Assistance", staffPhone());
    await open(staff.page, `/staff/disputes/${disputeId}`);
    await expect(staff.page.getByRole("heading", { name: "Preuves" })).toBeVisible();
    const both = staff.page.getByRole("list").filter({ has: staff.page.getByRole("img", { name: /Photo de preuve/ }) });
    await expect(both.getByRole("img")).toHaveCount(2);
    await loaded(staff.page.getByRole("img", { name: "Photo de preuve ajoutée par Acheteur Preuve" }));
    // l'assistance peut aussi en ajouter une, signée « Assistance »
    await staff.page.getByLabel("Choisir une photo").setInputFiles(file(await jpegBuffer(staff.page, 500, 500)));
    await staff.page.getByRole("button", { name: "Ajouter la preuve" }).click();
    await expect(staff.page.getByRole("img", { name: "Photo de preuve ajoutée par Assistance" })).toBeVisible();
  });

  test("B-E1 un fichier texte déguisé en image est refusé (interface et API)", async ({ makeActor }) => {
    const { buyer, conv } = await duo(makeActor);
    // interface : le navigateur ne sait pas lire ce « JPEG »
    await open(buyer.page, `/inbox/${conv}`);
    await buyer.page.getByLabel("Choisir une photo").setInputFiles(file(Buffer.from("juste du texte, pas une image"), "faux.jpg", "image/jpeg"));
    await expect(alerts(buyer.page).filter({ hasText: "n'a pas pu être lue" })).toBeVisible();
    await expect(buyer.page.getByRole("img", { name: "Aperçu de la photo à envoyer" })).toHaveCount(0);
    await buyer.page.getByLabel("Choisir une photo").setInputFiles(file(Buffer.from("autre texte"), "note.txt", "text/plain"));
    await expect(alerts(buyer.page).filter({ hasText: "n'a pas pu être lue" })).toBeVisible();

    // API : le type est vérifié sur le contenu, quoi que le client annonce
    for (const bad of [DISGUISED, "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:image/gif;base64,R0lGODlhAQABAAAAACw=", "http://exemple.cd/x.jpg", 42]) {
      const r = await sendPhoto(buyer, conv, { body: "x", photo: bad });
      expect(r.status(), `photo ${String(bad).slice(0, 30)}`).toBe(422);
    }
    const log = await (await buyer.request.get(`/api/v1/conversations/${conv}`)).json();
    expect(log.conversation.messages).toEqual([]);
    // ni texte ni photo
    expect((await sendPhoto(buyer, conv, { body: "  " })).status()).toBe(422);
  });

  test("B-E2 photo trop lourde : refusée par le serveur (message et preuve)", async ({ makeActor }) => {
    const { buyer, conv } = await duo(makeActor);
    const r = await sendPhoto(buyer, conv, { body: "", photo: TOO_BIG });
    expect(r.status()).toBe(422);
    expect((await r.json()).error.message).toMatch(/trop lourde/);
    const d = await disputed(makeActor);
    expect((await addEvidence(d.buyer, d.disputeId, { photo: TOO_BIG })).status()).toBe(422);
    expect((await addEvidence(d.buyer, d.disputeId, { photo: DISGUISED, note: "faux" })).status()).toBe(422);
    expect((await addEvidence(d.buyer, d.disputeId, { photo: PHOTO, note: "x".repeat(501) })).status()).toBe(422);
    expect((await (await d.buyer.request.get(`/api/v1/disputes/${d.disputeId}`)).json()).dispute.evidence).toEqual([]);
  });

  test("B-N1 accès : participants seulement ; tiers 404 ; sans session 401 ; en-têtes privés", async ({ makeActor, request }) => {
    const { seller, buyer, conv } = await duo(makeActor);
    const tiers = await makeActor("Tiers Photo");
    const m = await sendPhoto(buyer, conv, { body: "", photo: PNG });
    expect(m.status()).toBe(201);
    const msgUrl = (await m.json()).message.photoUrl as string;
    expect(msgUrl).toMatch(/^\/api\/v1\/private-photos\/[0-9a-f-]{36}$/);

    for (const who of [buyer, seller]) {
      const ok = await who.request.get(msgUrl);
      expect(ok.status()).toBe(200);
      expect(ok.headers()["content-type"]).toBe("image/png");
      expect(ok.headers()["cache-control"]).toMatch(/\bprivate\b/);
      expect(ok.headers()["cache-control"]).not.toMatch(/public/);
      expect(ok.headers()["x-content-type-options"]).toBe("nosniff");
      expect(ok.headers()["content-security-policy"]).toContain("sandbox");
    }
    expect((await tiers.request.get(msgUrl)).status()).toBe(404);
    expect((await request.get(msgUrl)).status()).toBe(401);
    expect((await tiers.request.get("/api/v1/private-photos/pas-un-uuid")).status()).toBe(404);
    expect((await tiers.request.get("/api/v1/private-photos/11111111-2222-4333-8444-555555555555")).status()).toBe(404);
    // l'assistance n'est pas participante d'une conversation : 404 aussi
    const staff = await makeActor("Assistance Photos", staffPhone());
    expect((await staff.request.get(msgUrl)).status()).toBe(404);
    // la page de la conversation est un 404 pour un tiers ; la liste du tiers ne montre rien
    expect((await tiers.page.goto(`/inbox/${conv}`))?.status()).toBe(404);
    expect((await (await tiers.request.get("/api/v1/conversations")).json()).conversations).toEqual([]);
    // jamais dans le service public des photos d'annonces
    expect((await request.get(`/api/v1/photos/${msgUrl.split("/").pop()}`)).status()).toBe(404);

    // preuves : parties et assistance, pas le tiers
    const d = await disputed(makeActor);
    const e = await addEvidence(d.buyer, d.disputeId, { photo: PHOTO, note: "preuve" });
    expect(e.status()).toBe(201);
    const evUrl = (await e.json()).dispute.evidence[0].photoUrl as string;
    for (const who of [d.buyer, d.seller, staff]) expect((await who.request.get(evUrl)).status()).toBe(200);
    expect((await tiers.request.get(evUrl)).status()).toBe(404);
    expect((await request.get(evUrl)).status()).toBe(401);
    expect((await tiers.request.get(`/api/v1/disputes/${d.disputeId}`)).status()).toBe(404);
    expect((await addEvidence(tiers, d.disputeId, { photo: PHOTO })).status()).toBe(404);
    // un participant d'une autre conversation ne peut pas lire cette photo de message
    expect((await d.buyer.request.get(msgUrl)).status()).toBe(404);
    // sans session : pas d'ajout, pas d'envoi
    expect((await request.post(`/api/v1/disputes/${d.disputeId}/evidence`, { data: { photo: PHOTO } })).status()).toBe(401);
    expect((await request.post(`/api/v1/conversations/${conv}/messages`, { data: { body: "", photo: PHOTO } })).status()).toBe(401);
  });

  test("B-E3 limites : 6 photos de preuve par membre et par litige ; 10 photos par 10 minutes dans les messages", async ({ makeActor }) => {
    const d = await disputed(makeActor);
    for (let i = 0; i < 6; i++) expect((await addEvidence(d.buyer, d.disputeId, { photo: PHOTO, note: `n${i}` })).status()).toBe(201);
    const over = await addEvidence(d.buyer, d.disputeId, { photo: PHOTO });
    expect(over.status()).toBe(409);
    expect((await over.json()).error.code).toBe("EVIDENCE_LIMIT");
    expect((await addEvidence(d.seller, d.disputeId, { photo: PHOTO })).status()).toBe(201); // limite par membre
    // le formulaire disparaît au plafond
    await open(d.buyer.page, `/orders/${d.orderId}/dispute`);
    await expect(d.buyer.page.getByText(/c'est le maximum pour ce litige/)).toBeVisible();
    await expect(d.buyer.page.getByRole("button", { name: "Ajouter la preuve" })).toHaveCount(0);

    const { buyer, conv } = await duo(makeActor);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await sendPhoto(buyer, conv, { body: `p${i}`, photo: PHOTO })).status());
    expect(codes.filter((c) => c === 201)).toHaveLength(10);
    expect(codes.filter((c) => c === 429)).toHaveLength(2);
    // le texte seul n'est pas touché par la limite des photos
    expect((await sendPhoto(buyer, conv, { body: "toujours possible" })).status()).toBe(201);
  });

  test("B-E4 litige clos : plus d'ajout de preuve, mais les photos restent visibles", async ({ makeActor }) => {
    const d = await disputed(makeActor);
    expect((await addEvidence(d.buyer, d.disputeId, { photo: PHOTO, note: "avant la décision" })).status()).toBe(201);
    const staff = await makeActor("Assistance Clôture", staffPhone());
    expect((await staff.request.post(`/api/v1/staff/disputes/${d.disputeId}/resolve`, { data: { outcome: "refund_buyer" } })).status()).toBe(200);
    expect((await addEvidence(d.seller, d.disputeId, { photo: PHOTO })).status()).toBe(409);
    await open(d.seller.page, `/orders/${d.orderId}/dispute`);
    await expect(d.seller.page.getByRole("img", { name: "Photo de preuve ajoutée par Acheteur Preuve" })).toBeVisible();
    await expect(d.seller.page.getByRole("button", { name: "Ajouter la preuve" })).toHaveCount(0);
  });
});
