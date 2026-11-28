import { maskPhone } from "../phone";

/**
 * Envoi de SMS (codes de connexion). Le métier ne connaît que cette interface.
 * Aucun fournisseur réel n'est branché : le choix (et le contrat, les clés, les numéros d'expéditeur autorisés
 * en RDC) revient à l'équipe. Voir replica/backend.md.
 */
export interface SmsProvider {
  readonly name: string;
  send(toE164: string, text: string): Promise<void>;
}

/** Développement et tests : écrit dans la console, ne contacte personne. Interdit en production. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = "console";
  sent: { to: string; text: string }[] = [];

  async send(to: string, text: string): Promise<void> {
    if (process.env.NODE_ENV === "production") throw new Error("ConsoleSmsProvider est interdit en production.");
    this.sent.push({ to, text });
    if (process.env.SMS_CONSOLE_QUIET !== "1") console.log(`[sms:console] vers ${maskPhone(to)} : ${text}`);
  }
}

export function createSmsProvider(): SmsProvider {
  const name = process.env.SMS_PROVIDER ?? "console";
  if (name === "console") return new ConsoleSmsProvider();
  throw new Error(`Fournisseur SMS « ${name} » non implémenté. Écrire un adaptateur SmsProvider (voir replica/backend.md).`);
}
