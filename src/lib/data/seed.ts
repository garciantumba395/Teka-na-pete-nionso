import type { Area, Category, Condition, Currency, Item, User } from "../types";
import { seedId } from "./ids";

// Données de départ. Fictives. Les photos sont des illustrations SVG générées ici (aucune image d'un tiers).

const XML_ESC = (s: string) => s.replace(/[&<>"']/g, "");

export function svgPhoto(label: string, hue: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 400'>` +
    `<rect width='300' height='400' fill='hsl(${hue} 35% 88%)'/>` +
    `<circle cx='150' cy='165' r='68' fill='hsl(${hue} 40% 72%)'/>` +
    `<rect x='92' y='228' width='116' height='112' rx='16' fill='hsl(${hue} 45% 58%)'/>` +
    `<text x='150' y='376' text-anchor='middle' font-family='sans-serif' font-size='20' fill='hsl(${hue} 30% 22%)'>${XML_ESC(label)}</text>` +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

type Cat = [id: string, parent: string | null, name: string, sellable: boolean];
const CATS: Cat[] = [
  ["cat-femme", null, "Femme", false],
  ["cat-robes", "cat-femme", "Robes", true],
  ["cat-hauts", "cat-femme", "Hauts", true],
  ["cat-pagnes", "cat-femme", "Pagnes et tissus", true],
  ["cat-chaussures-f", "cat-femme", "Chaussures femme", true],
  ["cat-sacs", "cat-femme", "Sacs", true],
  ["cat-homme", null, "Homme", false],
  ["cat-chemises", "cat-homme", "Chemises", true],
  ["cat-pantalons", "cat-homme", "Pantalons", true],
  ["cat-chaussures-h", "cat-homme", "Chaussures homme", true],
  ["cat-enfant", null, "Enfant", false],
  ["cat-vetements-e", "cat-enfant", "Vêtements enfant", true],
  ["cat-jouets", "cat-enfant", "Jouets", true],
  ["cat-maison", null, "Maison", false],
  ["cat-cuisine", "cat-maison", "Cuisine", true],
  ["cat-deco", "cat-maison", "Décoration", true],
  ["cat-electro", null, "Électronique", false],
  ["cat-telephones", "cat-electro", "Téléphones et accessoires", true],
  ["cat-audio", "cat-electro", "Audio", true],
];

export function seedCategories(): Category[] {
  return CATS.map(([id, parentId, name, isSellable]) => ({
    id: seedId(id),
    parentId: parentId ? seedId(parentId) : null,
    slug: id.replace(/^cat-/, ""),
    name,
    isSellable,
  }));
}

const PROVINCES = [
  "Kinshasa", "Kongo Central", "Kwango", "Kwilu", "Mai-Ndombe", "Équateur", "Mongala", "Nord-Ubangi", "Sud-Ubangi",
  "Tshuapa", "Kasaï", "Kasaï-Central", "Kasaï-Oriental", "Lomami", "Sankuru", "Maniema", "Sud-Kivu", "Nord-Kivu",
  "Ituri", "Haut-Uélé", "Bas-Uélé", "Tshopo", "Tanganyika", "Haut-Lomami", "Lualaba", "Haut-Katanga",
];

// Centres APPROXIMATIFS des communes de Kinshasa (à vérifier), utilisés seulement pour la recherche par rayon.
const COMMUNES: [string, number, number][] = [
  ["Bandalungwa", -4.333, 15.287], ["Barumbu", -4.317, 15.328], ["Bumbu", -4.372, 15.268], ["Gombe", -4.303, 15.307],
  ["Kalamu", -4.347, 15.317], ["Kasa-Vubu", -4.336, 15.307], ["Kimbanseke", -4.425, 15.37], ["Kinshasa", -4.318, 15.305],
  ["Kintambo", -4.318, 15.275], ["Kisenso", -4.405, 15.325], ["Lemba", -4.382, 15.31], ["Limete", -4.34, 15.35],
  ["Lingwala", -4.32, 15.3], ["Makala", -4.388, 15.29], ["Maluku", -4.09, 16.09], ["Masina", -4.395, 15.39],
  ["Matete", -4.383, 15.33], ["Mont-Ngafula", -4.463, 15.268], ["Ndjili", -4.398, 15.355], ["Ngaba", -4.378, 15.305],
  ["Ngaliema", -4.35, 15.24], ["Ngiri-Ngiri", -4.343, 15.298], ["Nsele", -4.355, 15.55], ["Selembao", -4.39, 15.275],
];

export function seedAreas(): Area[] {
  const areas: Area[] = [{ id: seedId("area-cd"), parentId: null, kind: "country", name: "République démocratique du Congo", lat: null, lng: null }];
  for (const p of PROVINCES) areas.push({ id: seedId(`area-prov-${slug(p)}`), parentId: seedId("area-cd"), kind: "province", name: p, lat: null, lng: null });
  for (const [name, lat, lng] of COMMUNES)
    areas.push({ id: seedId(`area-com-${slug(name)}`), parentId: seedId("area-prov-kinshasa"), kind: "commune", name, lat, lng });
  return areas;
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-");

export const SEED_PHONES = { marie: "+243810000001", patrick: "+243820000002", jp: "+243990000003" };

export function seedUsers(now: number): User[] {
  const base = { areaId: seedId("area-com-gombe"), verificationLevel: "phone" as const, createdAt: now - 90 * 86400_000 };
  return [
    { ...base, id: seedId("user-marie"), phone: SEED_PHONES.marie, displayName: "Marie K.", bio: "Je vends mes vêtements en bon état. Remise à Gombe ou Limete.", ratingAvg: 4.8, ratingCount: 31, areaId: seedId("area-com-gombe") },
    { ...base, id: seedId("user-patrick"), phone: SEED_PHONES.patrick, displayName: "Patrick M.", bio: "", ratingAvg: null, ratingCount: 0, areaId: seedId("area-com-lemba") },
    { ...base, id: seedId("user-jp"), phone: SEED_PHONES.jp, displayName: "Jean-Paul B.", bio: "Électronique et maison.", ratingAvg: 4.5, ratingCount: 12, areaId: seedId("area-com-ngaliema") },
  ];
}

type Seed = [title: string, cat: string, cond: Condition, price: number, cur: Currency, brand: string | null, size: string | null, seller: string, area: string, hue: number, desc: string];
// Prix en unités mineures : USD en cents, CDF en centimes (francs x 100).
const ITEMS: Seed[] = [
  ["Robe wax manches courtes", "cat-robes", "very_good", 1500, "USD", "Ankara", "M", "user-marie", "gombe", 25, "Portée deux fois. Tissu épais, doublure intérieure."],
  ["Sandales en cuir", "cat-chaussures-f", "good", 3_500_000, "CDF", null, "39", "user-marie", "limete", 30, "Semelle propre, quelques traces d'usage au talon."],
  ["Sac à main noir", "cat-sacs", "very_good", 2200, "USD", null, null, "user-marie", "gombe", 280, "Fermeture à glissière solide, deux poches intérieures."],
  ["Chemise homme blanche", "cat-chemises", "new", 1200, "USD", null, "L", "user-jp", "ngaliema", 200, "Jamais portée, étiquette retirée."],
  ["Pantalon jean slim", "cat-pantalons", "good", 4_200_000, "CDF", "Levi's", "32", "user-jp", "ngaliema", 215, "Légèrement délavé, aucune déchirure."],
  ["Baskets blanches", "cat-chaussures-h", "good", 2800, "USD", null, "42", "user-jp", "ngaliema", 190, "Semelles propres, lacets neufs."],
  ["Ensemble enfant 4 ans", "cat-vetements-e", "very_good", 900, "USD", null, "4 ans", "user-marie", "lemba", 140, "Deux pièces, coton doux."],
  ["Set de casseroles inox", "cat-cuisine", "very_good", 3500, "USD", null, null, "user-jp", "kalamu", 60, "Trois casseroles avec couvercles, fond épais."],
  ["Écouteurs filaires", "cat-audio", "new", 600, "USD", null, null, "user-jp", "ngaliema", 170, "Neufs dans leur boîte."],
  ["Pagne 6 yards", "cat-pagnes", "new_with_tags", 3000, "USD", null, null, "user-marie", "gombe", 10, "Motif géométrique, coupe de six yards."],
  ["Coque de téléphone", "cat-telephones", "new", 250, "USD", null, null, "user-jp", "kalamu", 250, "Silicone souple, plusieurs modèles."],
  ["Jouet en bois à empiler", "cat-jouets", "good", 1_500_000, "CDF", null, null, "user-marie", "limete", 45, "Six pièces, peinture en bon état."],
];

export function seedItems(now: number, areas: Area[]): Item[] {
  return ITEMS.map(([title, categoryId, condition, priceMinor, currency, brand, sizeLabel, sellerId, areaSlug, hue, description], i) => {
    const area = areas.find((a) => a.id === seedId(`area-com-${areaSlug}`))!;
    const at = now - (i + 1) * 3 * 3600_000;
    return {
      id: seedId(`item-${String(i + 1).padStart(2, "0")}`),
      sellerId: seedId(sellerId), categoryId: seedId(categoryId), title, description, condition, sizeLabel, brand, priceMinor, currency,
      status: "active" as const,
      areaId: area.id,
      lat: area.lat ? Math.round(area.lat * 100) / 100 : null,
      lng: area.lng ? Math.round(area.lng * 100) / 100 : null,
      photos: [svgPhoto(title.split(" ")[0], hue), svgPhoto("Détail", (hue + 20) % 360)],
      publishedAt: at,
      createdAt: at,
    };
  });
}
