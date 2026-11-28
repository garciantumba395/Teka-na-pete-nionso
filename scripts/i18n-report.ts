// Couverture des traductions : npm run i18n:report
// Pour chaque espace de noms : nombre de clés françaises et part traduite en anglais, lingala, swahili.
import { LOCALE_STATUS } from "../src/i18n/config";
import { NAMESPACES } from "../src/i18n/catalog";

const pct = (n: number, total: number) => (total === 0 ? "  -  " : `${String(Math.round((n / total) * 100)).padStart(3)} %`);
let total = 0, en = 0, ln = 0, sw = 0;
console.log("espace".padEnd(16), "clés fr".padStart(8), "en".padStart(7), "ln".padStart(7), "sw".padStart(7), "  client");
for (const ns of NAMESPACES) {
  const keys = Object.keys(ns.fr);
  const have = (l: "en" | "ln" | "sw") => keys.filter((k) => k in ns[l]).length;
  total += keys.length; en += have("en"); ln += have("ln"); sw += have("sw");
  console.log(ns.name.padEnd(16), String(keys.length).padStart(8), pct(have("en"), keys.length).padStart(7), pct(have("ln"), keys.length).padStart(7), pct(have("sw"), keys.length).padStart(7), ns.client ? "  oui" : "  non");
}
console.log("-".repeat(54));
console.log("TOTAL".padEnd(16), String(total).padStart(8), pct(en, total).padStart(7), pct(ln, total).padStart(7), pct(sw, total).padStart(7));
console.log(`\nStatut : en=${LOCALE_STATUS.en}, ln=${LOCALE_STATUS.ln}, sw=${LOCALE_STATUS.sw} (« beta » = pas encore relu par un locuteur natif)`);
