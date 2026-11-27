import { describe, expect, it } from "vitest";
import { checkListingText, compileRules, DEFAULT_RULES, defaultCompiledRules, findProhibited, normalizeText, publicRule } from "../prohibited";

const C = defaultCompiledRules();
const hit = (t: string) => findProhibited(t, C)?.ruleId ?? null;

describe("articles interdits : correspondance", () => {
  it("normalise sans accent ni casse, ponctuation = espace", () => {
    expect(normalizeText("  L'ARMÉE d'été — Œuvre ")).toBe("l armee d ete oeuvre");
  });
  it("limites de mots : pas de faux positifs sur des mots qui contiennent un mot interdit", () => {
    for (const t of ["Alarme de voiture", "Bracelet charme", "Armée du salut", "Armoire en bois", "Lecteur de cartouche d'encre", "Pistolet à colle", "Pistolet à eau pour enfant",
      "Robe couleur ivoire", "Maillot Côte d'Ivoire", "Téléphone non volé, facture fournie", "Robe wax taille M", "Prix 7,62 $", "Drogueries", "Sac de fortune", "Fusil à eau jouet"])
      expect(hit(t), t).toBeNull();
  });
  it("détecte les mots interdits, au pluriel, avec accents et casse", () => {
    expect(hit("Vends ARME à feu")).toBe("armes");
    expect(hit("lot de munitions 9mm")).toBe("armes");
    expect(hit("Cocaïne pure")).toBe("drogues");
    expect(hit("du BANGI de qualité")).toBe("drogues");
    expect(hit("Tramadol 225mg")).toBe("medicaments");
    expect(hit("Sac contrefaçon de marque")).toBe("contrefacons");
    expect(hit("Défense d'éléphant")).toBe("faune");
    expect(hit("faux passeport")).toBe("documents");
    expect(hit("Téléphone volé")).toBe("vole");
    expect(hit("Film porno")).toBe("adultes");
    expect(hit("Coltan brut")).toBe("minerais");
  });
  it("contournements par espaces, séparateurs, lettres espacées et chiffres", () => {
    expect(hit("arme    à\n\tfeu")).toBe("armes");
    expect(hit("c o c a ï n e")).toBe("drogues");
    expect(hit("c.o.c.a.i.n.e")).toBe("drogues");
    expect(hit("c0caïne")).toBe("drogues");
    expect(hit("p1st0let automatique")).toBe("armes");
    expect(hit("K-a-l-a-c-h-n-i-k-o-v")).toBe("armes");
    expect(hit("ARME-À-FEU")).toBe("armes");
    expect(hit("l'arme")).toBe("armes");
  });
  it("les tailles et séries de lettres isolées ne déclenchent rien", () => {
    expect(hit("Tailles S M L XL disponibles")).toBeNull();
    expect(hit("Taille 4 5 6 7 8")).toBeNull();
  });
  it("texte vide, très long, caractères spéciaux, jamais d'exception", () => {
    expect(hit("")).toBeNull();
    expect(hit("   ")).toBeNull();
    expect(hit("!!! ??? ###")).toBeNull();
    expect(hit("😀👗 robe 💃")).toBeNull();
    expect(hit("a".repeat(100_000))).toBeNull();
    expect(hit("x ".repeat(50_000) + "pistolet")).toBe("armes");
    expect(hit("(((((.*+?^$|\\[]{} regex")).toBeNull();
  });
  it("performance : 2 000 caractères, avec toutes les règles par défaut", () => {
    const text = "Belle robe en wax taille M, très bon état, portée deux fois. ".repeat(40).slice(0, 2000);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) findProhibited(text, C);
    expect((performance.now() - t0) / 100).toBeLessThan(15);
  });
  it("le résultat ne contient que règle, libellé et message : jamais le mot trouvé", () => {
    const h = findProhibited("vends cocaine", C)!;
    expect(Object.keys(h).sort()).toEqual(["label", "message", "ruleId"]);
    expect(JSON.stringify(h).toLowerCase()).not.toContain("cocaine");
    for (const r of DEFAULT_RULES.map(publicRule)) expect(Object.keys(r).sort()).toEqual(["id", "label", "message"]);
  });
  it("checkListingText désigne le champ : titre, puis description, puis marque", () => {
    expect(checkListingText({ title: "Robe", description: "avec un pistolet", brand: "" }, C)?.field).toBe("description");
    expect(checkListingText({ title: "Pistolet 9mm", description: "avec cocaine" }, C)?.field).toBe("title");
    expect(checkListingText({ title: "Robe", description: "belle", brand: "Kalachnikov" }, C)?.field).toBe("brand");
    expect(checkListingText({ title: "Robe", description: "belle", brand: "Zara" }, C)).toBeNull();
  });
  it("règles personnalisées : exceptions", () => {
    const c = compileRules([{ id: "x", label: "X", message: "M", keywords: ["noix"], except: ["noix de coco"] }]);
    expect(findProhibited("noix de coco", c)).toBeNull();
    expect(findProhibited("des noix", c)?.ruleId).toBe("x");
  });
  it("jeu par défaut cohérent : identifiants uniques, mots-clés non vides, messages en français", () => {
    const ids = DEFAULT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DEFAULT_RULES) {
      expect(r.keywords.length).toBeGreaterThan(0);
      expect(r.message.length).toBeGreaterThan(20);
      expect(r.id).toMatch(/^[a-z0-9-]{2,40}$/);
    }
  });
});
