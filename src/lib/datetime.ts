// Heures affichées dans un fuseau fixe (Africa/Kinshasa), identique côté serveur et côté navigateur :
// le fuseau du téléphone ou du serveur n'entre jamais en jeu.
const fmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });
const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kinshasa" });

export const formatDateTime = (ms: number): string => fmt.format(new Date(ms));
export const formatDateTimeShort = (ms: number): string => fmtShort.format(new Date(ms));
