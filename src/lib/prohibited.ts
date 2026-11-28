// Catalogue des articles interdits et correspondance de texte. Module PUR (aucun accès base, réseau ni horloge) : les deux
// couches de données l'utilisent, les tests unitaires le couvrent seul.
//
// AVIS : ce catalogue est une base de travail prudente pour la RDC. Il doit être VALIDÉ par un juriste local avant le
// lancement public (lois sur les armes, stupéfiants, médicaments, faune protégée, minerais, documents officiels).
//
// Principes de correspondance :
//  - comparaison sans accent ni casse ; toute ponctuation compte comme une espace (« l'arme », « arme-à-feu ») ;
//  - LIMITES DE MOTS : « arme » ne bloque ni « alarme » ni « charme » ni « armée » ; le pluriel (s, x) est accepté ;
//  - contournements courants : lettres espacées (« c o c a ï n e », « c.o.c.a.ï.n.e »), chiffres à la place des lettres (« c0caïne ») ;
//  - exceptions par règle (« pistolet à colle », « Côte d'Ivoire », « non volé ») pour éviter les faux positifs ;
//  - le refus ne désigne JAMAIS le mot trouvé : seul le message générique de la règle sort de ce module.

export interface ProhibitedRule {
  id: string;
  /** Libellé court affiché sur la page publique des règles. */
  label: string;
  /** Message d'explication montré au vendeur en cas de refus. */
  message: string;
  /** Mots et expressions interdits (jamais publiés). */
  keywords: string[];
  /** Expressions légitimes qui contiennent un mot interdit : elles sont ignorées pour cette règle. */
  except?: string[];
}

/** Ce que la page publique et l'interface d'administration voient : jamais les mots-clés. */
export type PublicProhibitedRule = Pick<ProhibitedRule, "id" | "label" | "message">;

export interface ProhibitedHit {
  ruleId: string;
  label: string;
  message: string;
}

export const publicRule = (r: ProhibitedRule): PublicProhibitedRule => ({ id: r.id, label: r.label, message: r.message });

/** Jeu de règles par défaut : repli du code, et contenu inséré par la donnée de référence (seedReference). */
export const DEFAULT_RULES: ProhibitedRule[] = [
  {
    id: "armes",
    label: "Armes et munitions",
    message: "Les armes, les munitions et leurs accessoires ne peuvent pas être vendus ici. Retire-les de ton annonce.",
    keywords: [
      "arme", "arme a feu", "arme blanche", "pistolet", "revolver", "fusil", "carabine", "kalachnikov", "ak47", "ak 47", "mitraillette",
      "mitrailleuse", "lance roquette", "grenade", "poignard", "baionnette", "taser", "pistolet electrique", "matraque electrique",
      "poing americain", "munition", "cartouche de chasse", "cartouche calibre", "cartouche de fusil", "balle de calibre", "chargeur d arme",
      "chargeur de pistolet", "9mm", "calibre 12", "gilet pare balles", "silencieux pour arme",
    ],
    except: [
      "pistolet a colle", "pistolet a eau", "pistolet a peinture", "pistolet a silicone", "pistolet a graisse", "pistolet a air comprime pour pneu",
      "fusil a eau", "fusil jouet", "pistolet jouet", "arme jouet", "armes jouets", "arme de jeu", "armes de jeu", "grenade jouet",
    ],
  },
  {
    id: "drogues",
    label: "Drogues et stupéfiants",
    message: "Les drogues, les stupéfiants et leurs dérivés sont interdits à la vente. Cette annonce ne peut pas être publiée.",
    keywords: [
      "drogue", "stupefiant", "cocaine", "heroine", "cannabis", "chanvre indien", "marijuana", "bangi", "amphetamine", "methamphetamine",
      "ecstasy", "mdma", "lsd", "opium", "crack cocaine", "weed", "haschisch", "hashish",
    ],
  },
  {
    id: "medicaments",
    label: "Médicaments",
    message: "Les médicaments (surtout sur ordonnance) ne peuvent pas être vendus entre particuliers. Passe par une pharmacie agréée.",
    keywords: [
      "medicament", "tramadol", "diazepam", "valium", "morphine", "codeine", "amoxicilline", "antibiotique", "viagra", "pilule", "ordonnance medicale",
      "comprime", "gelule", "vaccin", "insuline", "sirop contre la toux",
    ],
  },
  {
    id: "contrefacons",
    label: "Produits contrefaits",
    message: "Les contrefaçons et les imitations de marque sont interdites. Ne vends que des articles authentiques.",
    keywords: [
      "contrefacon", "contrefait", "contrefaite", "contrefaits", "contrefaites", "replica", "fake", "faux billet", "fausse monnaie", "qualite miroir",
      "copie de marque", "copie conforme", "grade aaa", "imitation de marque", "faux nike", "faux adidas", "fausse marque",
    ],
  },
  {
    id: "faune",
    label: "Animaux protégés, ivoire et trophées",
    message: "Les animaux protégés, l'ivoire et les trophées de faune sauvage sont interdits à la vente.",
    keywords: [
      "ivoire d elephant", "ivoire brut", "ivoire sculpte", "sculpture en ivoire", "statuette en ivoire", "bijou en ivoire", "bijoux en ivoire",
      "bracelet en ivoire", "pointe d ivoire", "defense d elephant", "pangolin", "ecaille de pangolin", "peau de leopard", "peau de lion", "peau d okapi",
      "corne de rhinoceros", "bonobo vivant", "gorille vivant", "chimpanze vivant", "singe vivant", "bebe singe", "bebe chimpanze", "perroquet gris du gabon",
      "viande de brousse", "viande de singe", "trophee de chasse",
    ],
  },
  {
    id: "documents",
    label: "Documents officiels",
    message: "Les documents officiels (pièces d'identité, passeports, diplômes, actes) ne se vendent pas, authentiques ou non.",
    keywords: [
      "faux papier", "faux passeport", "faux diplome", "faux permis", "fausse carte d identite", "fausses pieces d identite", "carte d electeur",
      "passeport vierge", "carte d identite vierge", "visa a vendre", "passeport a vendre", "acte de naissance", "casier judiciaire", "carte grise",
      "plaque d immatriculation", "diplome a vendre",
    ],
  },
  {
    id: "vole",
    label: "Matériel volé",
    message: "Les articles volés ou de provenance douteuse sont interdits. Si tu as un doute sur l'origine d'un article, ne le vends pas.",
    keywords: [
      "article vole", "objet vole", "materiel vole", "telephone vole", "ordinateur vole", "vehicule vole", "moto volee", "voiture volee",
      "produit du vol", "recel", "imei efface", "imei modifie", "imei change", "provenance douteuse", "tombe du camion", "bien mal acquis",
    ],
    except: ["pas vole", "non vole", "jamais vole", "ni vole", "pas de recel"],
  },
  {
    id: "adultes",
    label: "Contenu pour adultes",
    message: "Le contenu et les articles à caractère sexuel ne sont pas autorisés sur la plateforme.",
    keywords: [
      "pornographie", "pornographique", "porno", "video porno", "film x", "dvd x", "sex toy", "sextoy", "godemiche", "escort", "prostitution",
      "services sexuels", "xxx",
    ],
  },
  {
    id: "dangereux",
    label: "Produits dangereux",
    message: "Les explosifs, les produits chimiques dangereux et les matières radioactives sont interdits à la vente.",
    keywords: [
      "explosif", "dynamite", "detonateur", "poudre noire", "acide sulfurique", "cyanure", "mercure liquide", "matiere radioactive", "uranium",
      "produit chimique dangereux", "gaz lacrymogene", "bombe lacrymogene", "petard", "feu d artifice",
    ],
  },
  {
    id: "minerais",
    label: "Minerais bruts non certifiés",
    message: "Les minerais bruts (or, diamant, coltan, cobalt, cassitérite) ne se vendent pas ici : leur commerce est réglementé.",
    keywords: ["or brut", "diamant brut", "diamants bruts", "coltan", "cobalt brut", "cassiterite", "wolframite", "pepite d or", "minerai brut", "minerais bruts"],
  },
  {
    id: "uniformes",
    label: "Uniformes et insignes officiels",
    message: "Les uniformes, galons et insignes de l'armée ou de la police ne peuvent pas être vendus.",
    keywords: ["uniforme militaire", "uniforme de police", "uniforme de la police", "uniforme fardc", "insigne fardc", "insigne de police", "galon militaire", "badge de police"],
  },
  {
    id: "fraude",
    label: "Cartes et comptes piratés",
    message: "Les cartes bancaires clonées, comptes piratés et identifiants volés sont interdits.",
    keywords: ["carte clonee", "cartes clonees", "carte bancaire clonee", "compte pirate", "comptes pirates", "identifiants voles", "numeros de carte", "logiciel pirate"],
  },
];

// ---------------------------------------------------------------- normalisation

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Minuscules, sans accent ni marque combinante. Les ligatures usuelles sont dépliées (œ → oe). */
function fold(s: string): string {
  return s.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/\p{M}/gu, "");
}

/** Forme canonique d'une expression : lettres et chiffres séparés par une seule espace. */
export function normalizeText(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * « c o c a i n e » → « cocaine » : une suite d'au moins 4 lettres isolées est recollée. Comme la suite peut avaler un mot d'une
 * lettre voisin (« a r m e a feu » : le « a » final est un mot), on produit aussi les formes qui laissent la première
 * ou la dernière lettre de la suite à part.
 */
function squash(norm: string): string[] {
  const RUN = /(?:^| )((?:[a-z] ){3,}[a-z])(?= |$)/g;
  if (!RUN.test(norm)) return [];
  const make = (join: (letters: string[]) => string) => norm.replace(RUN, (_m, run: string) => ` ${join(run.split(" "))}`).trim();
  return [make((l) => l.join("")), make((l) => `${l.slice(0, -1).join("")} ${l[l.length - 1]}`), make((l) => `${l[0]} ${l.slice(1).join("")}`)];
}

/** Chiffres et symboles utilisés à la place de lettres, dans les mots qui contiennent aussi des lettres. */
function leet(folded: string): string {
  const tokens = folded.match(/[a-z0-9@$]+/g) ?? [];
  return tokens.map((t) => (/[a-z]/.test(t) ? t.replace(/[013457@$]/g, (c) => LEET[c] ?? c) : t)).join(" ");
}

/** Variantes du texte analysé. Un texte vide n'en donne aucune. */
function variants(text: string): string[] {
  const folded = fold(text);
  const base = folded.replace(/[^a-z0-9]+/g, " ").trim();
  if (!base) return [];
  const out = new Set<string>([base, ...squash(base)]);
  const l = leet(folded);
  if (l && l !== base) {
    out.add(l);
    for (const q of squash(l)) out.add(q);
  }
  return [...out];
}

// ---------------------------------------------------------------- correspondance

interface CompiledRule extends PublicProhibitedRule {
  keywords: string[];
  except: string[];
}

export interface CompiledRules {
  readonly rules: CompiledRule[];
}

/** Prépare les règles : normalise une fois les mots-clés et les exceptions. */
export function compileRules(rules: ProhibitedRule[]): CompiledRules {
  return {
    rules: rules.map((r) => ({
      id: r.id,
      label: r.label,
      message: r.message,
      keywords: [...new Set(r.keywords.map(normalizeText).filter(Boolean))],
      except: (r.except ?? []).map(normalizeText).filter(Boolean),
    })),
  };
}

/** Le mot-clé figure dans le texte (entouré d'espaces), avec un pluriel en s ou x accepté. */
function hasPhrase(padded: string, kw: string): boolean {
  const needle = ` ${kw}`;
  let from = 0;
  for (;;) {
    const i = padded.indexOf(needle, from);
    if (i < 0) return false;
    const end = i + needle.length;
    const c = padded[end];
    if (c === " ") return true;
    if ((c === "s" || c === "x") && padded[end + 1] === " ") return true;
    from = i + 1;
  }
}

function withoutExceptions(padded: string, except: string[]): string {
  let t = padded;
  for (const ex of except) {
    const pat = ` ${ex} `;
    if (t.includes(pat)) t = t.split(pat).join("  ");
  }
  return t;
}

/** Première règle qui s'applique au texte, ou null. Ne renvoie jamais le mot trouvé. */
export function findProhibited(text: string, compiled: CompiledRules): ProhibitedHit | null {
  if (!text) return null;
  const vs = variants(text).map((v) => ` ${v} `);
  if (!vs.length) return null;
  for (const rule of compiled.rules) {
    for (const v of vs) {
      const t = rule.except.length ? withoutExceptions(v, rule.except) : v;
      if (rule.keywords.some((kw) => hasPhrase(t, kw))) return { ruleId: rule.id, label: rule.label, message: rule.message };
    }
  }
  return null;
}

export type ProhibitedField = "title" | "description" | "brand";

/** Contrôle d'une annonce : titre, description et marque. Retourne le champ à désigner et le message de la règle. */
export function checkListingText(
  input: { title?: string | null; description?: string | null; brand?: string | null },
  compiled: CompiledRules,
): { field: ProhibitedField; hit: ProhibitedHit } | null {
  for (const field of ["title", "description", "brand"] as const) {
    const hit = findProhibited(input[field] ?? "", compiled);
    if (hit) return { field, hit };
  }
  return null;
}

let defaultCompiled: CompiledRules | null = null;
/** Règles par défaut compilées une fois (couche factice et repli). */
export function defaultCompiledRules(): CompiledRules {
  return (defaultCompiled ??= compileRules(DEFAULT_RULES));
}
