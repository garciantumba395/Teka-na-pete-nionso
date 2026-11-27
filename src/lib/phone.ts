/**
 * Normalise un numéro congolais en E.164 (+243 + 9 chiffres).
 * Accepte « +243 81 234 5678 », « 0812345678 », « 812345678 », « 00243812345678 ».
 * Un numéro mobile commence par 8 ou 9 après le 0 : cette règle de préfixe est à VÉRIFIER auprès des opérateurs.
 */
export function normalizeDrcPhone(input: string): string | null {
  let d = input.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("243")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return /^[89]\d{8}$/.test(d) ? `+243${d}` : null;
}

export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 4)} •• ••• ${e164.slice(-3)}` : e164;
}
