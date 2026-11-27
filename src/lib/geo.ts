// Même formule que distance_km() dans replica/schema.sql (haversine, rayon moyen 6371,0088 km).
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

/** Arrondit à 0,01° (≈ 1 km) : on ne stocke jamais l'emplacement exact du vendeur. */
export function coarsen(coord: number): number {
  return Math.round(coord * 100) / 100;
}
