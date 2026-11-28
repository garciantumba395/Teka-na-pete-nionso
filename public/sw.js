/* Service worker : prudent par construction, pensé pour les réseaux lents.
 *
 * CE QU'IL FAIT
 *  - Pré-cache la page hors ligne (/offline, document autonome) et les icônes.
 *  - Met en cache à la demande les fichiers statiques versionnés de Next (/_next/static/ : leur nom change à chaque contenu)
 *    et les icônes : les visites suivantes se chargent sans refaire ces téléchargements.
 *  - Pages HTML : RÉSEAU D'ABORD, jamais mises en cache (elles contiennent le nom du membre connecté, ses commandes...).
 *    Si le réseau échoue, on affiche /offline.
 *
 * CE QU'IL NE FAIT JAMAIS
 *  - Aucune réponse de /api n'est mise en cache ni interceptée : elles passent directement au réseau.
 *  - Aucune page privée (commande, portefeuille, messages, compte, vente, assistance) n'est mise en cache.
 *  - Aucune requête autre que GET, aucune requête vers un autre site.
 *
 * MISE À JOUR : changer VERSION invalide les anciens caches (supprimés à l'activation). Le navigateur revérifie ce fichier
 * à chaque visite (en-tête no-cache, voir next.config.ts) ; la nouvelle version prend la main sans recharger la page en cours.
 */
const VERSION = "v1";
const CACHE = "marketplace-static-" + VERSION;
const PREFIX = "marketplace-";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg"];
const CACHEABLE = /^\/(_next\/static\/|icons\/)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Un échec isolé (réseau capricieux) ne doit pas empêcher l'installation : la page hors ligne est réessayée à la navigation suivante.
      await Promise.all(PRECACHE.map((u) => cache.add(new Request(u, { cache: "reload" })).catch(() => undefined)));
      await self.skipWaiting(); // pas d'attente de fermeture des onglets : les pages sont servies par le réseau, rien ne se mélange
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // jamais : le réseau seul répond

  // Pages : réseau d'abord, page hors ligne si le réseau est coupé. Rien n'est stocké.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || new Response("Pas de connexion.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } })),
    );
    return;
  }

  // Fichiers statiques versionnés : cache d'abord, sinon réseau puis stockage.
  if (CACHEABLE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.status === 200 && res.type === "basic") cache.put(req, res.clone()).catch(() => undefined);
        return res;
      })(),
    );
  }
  // Tout le reste (dont /offline en direct, /sw.js, le manifeste) : comportement normal du navigateur.
});
