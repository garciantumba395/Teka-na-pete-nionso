import type { Config } from "tailwindcss";
import { tokens } from "./src/styles/tailwind.tokens";

// Les jetons viennent de replica/design/tokens.json (npm run sync:design).
// Preflight désactivé : primitives.css porte déjà la remise à zéro minimale.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  corePlugins: { preflight: false },
  theme: { extend: tokens as unknown as NonNullable<Config["theme"]>["extend"] },
};

export default config;
