/**
 * Garde de configuration de PRODUCTION. Le serveur refuse de démarrer avec des valeurs de développement :
 * un secret par défaut, un fournisseur de paiement factice ou un « SMS » écrit dans la console
 * rendraient le service exploitable par n'importe qui.
 */
export type Env = Record<string, string | undefined>;

const DEV_DEFAULTS = ["dev-only-handover-secret-change-me", "dev-only-webhook-secret-change-me", "dev-only-otp-secret-change-me"];

export function productionProblems(env: Env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const p: string[] = [];
  const need = (k: string, why: string) => {
    const v = env[k];
    if (!v) p.push(`${k} manquante (${why})`);
    else if (DEV_DEFAULTS.includes(v) || v.length < 24) p.push(`${k} trop courte ou valeur de développement (${why}) : 24 caractères aléatoires minimum`);
  };
  if ((env.DATA_LAYER ?? "fake") !== "pg") p.push("DATA_LAYER doit valoir « pg » : la couche factice est interdite en production");
  if (!env.DATABASE_URL) p.push("DATABASE_URL manquante");
  need("HANDOVER_SECRET", "dérive les codes de remise");
  need("OTP_SECRET", "protège les codes SMS");
  need("CRON_SECRET", "protège les routes de tâches planifiées");
  if ((env.PAYMENT_PROVIDER ?? "fake") === "fake" && env.ALLOW_FAKE_PAYMENTS !== "1")
    p.push("PAYMENT_PROVIDER=fake interdit en production : brancher un vrai fournisseur (replica/backend.md)");
  else if ((env.PAYMENT_PROVIDER ?? "fake") !== "fake") need("PSP_WEBHOOK_SECRET", "vérifie la signature des webhooks du PSP");
  if ((env.SMS_PROVIDER ?? "console") === "console") p.push("SMS_PROVIDER=console interdit en production : brancher un vrai fournisseur SMS (replica/backend.md)");
  if (env.DEV_FIXED_OTP) p.push("DEV_FIXED_OTP ne doit pas être défini en production");
  return p;
}

export function assertProductionConfig(env: Env = process.env): void {
  const problems = productionProblems(env);
  if (problems.length) throw new Error(`Configuration de production invalide :\n - ${problems.join("\n - ")}`);
}
