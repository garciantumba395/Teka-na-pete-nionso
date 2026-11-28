import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientDict, flatten, NAMESPACES, translatorFor } from "../catalog";
import { asLocale, fromAcceptLanguage, LOCALES } from "../config";
import { createTranslator, interpolate } from "../translate";

const placeholders = (s: string) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");

describe("langues : configuration", () => {
  it("reconnaît les codes pris en charge et rejette le reste", () => {
    expect(asLocale("en")).toBe("en");
    expect(asLocale("EN")).toBeNull();
    expect(asLocale("kg")).toBeNull();
    expect(asLocale(undefined)).toBeNull();
    expect(asLocale("fr; drop")).toBeNull();
  });
  it("choisit la meilleure langue de l'en-tête Accept-Language", () => {
    expect(fromAcceptLanguage("fr-CD,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(fromAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(fromAcceptLanguage("de,es;q=0.8,sw;q=0.5")).toBe("sw");
    expect(fromAcceptLanguage("de,es")).toBeNull();
    expect(fromAcceptLanguage("en;q=0,fr;q=0.2")).toBe("fr");
    expect(fromAcceptLanguage(null)).toBeNull();
    expect(fromAcceptLanguage("*")).toBeNull();
  });
});

describe("traducteur", () => {
  it("interpole les variables et laisse visible une variable absente", () => {
    expect(interpolate("Bonjour {name}", { name: "Marie" })).toBe("Bonjour Marie");
    expect(interpolate("{a} et {b}", { a: 1 })).toBe("1 et {b}");
    expect(interpolate("sans variable")).toBe("sans variable");
  });
  it("choisit le pluriel d'après count, avec repli sur la clé de base", () => {
    const t = createTranslator("fr", { "n.x_one": "{count} article", "n.x_other": "{count} articles", "n.y": "valeur" });
    expect(t("n.x", { count: 0 })).toBe("0 article"); // le français traite 0 comme singulier
    expect(t("n.x", { count: 1 })).toBe("1 article");
    expect(t("n.x", { count: 5 })).toBe("5 articles");
    expect(t("n.y", { count: 3 })).toBe("valeur");
    const en = createTranslator("en", { "n.x_one": "{count} item", "n.x_other": "{count} items" });
    expect(en("n.x", { count: 0 })).toBe("0 items");
    expect(en("n.x", { count: 1 })).toBe("1 item");
  });
  it("se replie sur le français puis sur la clé elle-même, sans jamais lever d'erreur", () => {
    const t = createTranslator("en", { "a.b": "B" }, { "a.b": "b-fr", "a.c": "c-fr", "a.p_one": "{count} un", "a.p_other": "{count} plusieurs" });
    expect(t("a.b")).toBe("B");
    expect(t("a.c")).toBe("c-fr");
    expect(t("a.zzz")).toBe("a.zzz");
    expect(t("a.p", { count: 2 })).toBe("2 plusieurs");
  });
  it("ne laisse pas une valeur de variable fabriquer un marqueur", () => {
    expect(interpolate("{a}", { a: "{b}" })).toBe("{b}");
  });
});

describe("catalogues : complétude et cohérence", () => {
  it("les espaces de noms ont des noms uniques et valides", () => {
    const names = NAMESPACES.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });
  it("toute clé française existe en anglais, avec les mêmes variables", () => {
    const problems: string[] = [];
    for (const ns of NAMESPACES) {
      for (const [k, fr] of Object.entries(ns.fr)) {
        const en = ns.en[k];
        if (en === undefined) problems.push(`${ns.name}.${k} : manque en anglais`);
        else if (placeholders(fr).join() !== placeholders(en).join()) problems.push(`${ns.name}.${k} : variables différentes fr/en`);
      }
      for (const k of Object.keys(ns.en)) if (!(k in ns.fr)) problems.push(`${ns.name}.${k} : en sans fr`);
    }
    expect(problems).toEqual([]);
  });
  it("lingala et swahili : pas de clé inconnue du français, mêmes variables, pas de texte vide", () => {
    const problems: string[] = [];
    for (const ns of NAMESPACES) {
      for (const lang of ["ln", "sw"] as const) {
        for (const [k, v] of Object.entries(ns[lang])) {
          if (!(k in ns.fr)) problems.push(`${ns.name}.${k} (${lang}) : inconnue du français`);
          else if (placeholders(ns.fr[k]).join() !== placeholders(v).join()) problems.push(`${ns.name}.${k} (${lang}) : variables différentes`);
          if (v.trim() === "") problems.push(`${ns.name}.${k} (${lang}) : vide`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
  it("les clés sont bien formées et les valeurs françaises non vides", () => {
    for (const ns of NAMESPACES) {
      for (const [k, v] of Object.entries(ns.fr)) {
        expect(k, `${ns.name}.${k}`).toMatch(/^[a-z][a-zA-Z0-9_]*$/);
        expect(v.trim(), `${ns.name}.${k}`).not.toBe("");
      }
    }
  });
  it("une variante de pluriel est toujours accompagnée de sa forme « other »", () => {
    const problems: string[] = [];
    for (const ns of NAMESPACES) {
      for (const lang of LOCALES) {
        const keys = Object.keys(ns[lang]);
        for (const k of keys) {
          if (/_(zero|one|two|few|many)$/.test(k) && !keys.includes(`${base(k)}_other`)) problems.push(`${ns.name}.${k} (${lang}) : pas de _other`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
  it("le dictionnaire client est un sous-ensemble : jamais d'espace serveur, toujours replié sur le français", () => {
    const client = clientDict("ln");
    for (const ns of NAMESPACES.filter((n) => !n.client)) {
      for (const k of Object.keys(ns.fr)) expect(client[`${ns.name}.${k}`], `${ns.name}.${k}`).toBeUndefined();
    }
    for (const k of Object.keys(flatten("fr", true))) expect(client[k], k).toBeDefined();
  });
  it("le traducteur serveur traduit une clé existante dans chaque langue", () => {
    for (const l of LOCALES) expect(translatorFor(l)("shell.nav_home")).not.toBe("shell.nav_home");
    expect(translatorFor("en")("shell.nav_home")).toBe("Home");
    expect(translatorFor("sw")("shell.unread", { count: 2 })).toContain("2");
  });
});

// Garde contre les fautes de frappe : toute clé littérale passée à t("…") doit exister en français.
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === "__tests__" || f === "node_modules") continue;
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("usage des clés dans le code", () => {
  it("toute clé littérale de t(\"espace.clé\") existe dans le catalogue français", () => {
    const fr = flatten("fr");
    const missing: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\bt\(\s*["'`]([a-z][a-z0-9_]*\.[a-zA-Z0-9_.]+)["'`]/g)) {
        const key = m[1];
        const exists = key in fr || `${key}_other` in fr;
        if (!exists) missing.push(`${file.replace(process.cwd() + "/", "")} : ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
