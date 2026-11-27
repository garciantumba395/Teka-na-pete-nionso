import { FEES } from "./fees";
import { toUsdMinor } from "./money";
import type { Category, Condition, Currency } from "./types";

export const CONDITIONS: { value: Condition; label: string }[] = [
  { value: "new_with_tags", label: "Neuf avec étiquette" },
  { value: "new", label: "Neuf sans étiquette" },
  { value: "very_good", label: "Très bon état" },
  { value: "good", label: "Bon état" },
  { value: "satisfactory", label: "État correct" },
];

export interface ListingInput {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  sizeLabel?: string | null;
  brand?: string | null;
  priceMinor: number;
  currency: string;
  areaId?: string | null;
  photos: string[];
}

export type FieldErrors = Partial<Record<keyof ListingInput | "form", string>>;

/** Règles de publication, appliquées par le SERVEUR (le client ne peut pas contourner plafond ni catégorie). */
export function validateListing(input: ListingInput, categories: Category[]): FieldErrors {
  const errors: FieldErrors = {};
  const title = input.title?.trim() ?? "";
  if (title.length < 3 || title.length > 80) errors.title = "Le titre doit faire entre 3 et 80 caractères.";
  if ((input.description ?? "").length > 2000) errors.description = "La description est limitée à 2 000 caractères.";
  const cat = categories.find((c) => c.id === input.categoryId);
  if (!cat) errors.categoryId = "Choisis une catégorie.";
  else if (!cat.isSellable) errors.categoryId = "Cette catégorie n'accepte pas d'annonces.";
  if (!CONDITIONS.some((c) => c.value === input.condition)) errors.condition = "Choisis l'état de l'article.";
  if (input.currency !== "USD" && input.currency !== "CDF") errors.currency = "Devise non prise en charge.";
  const price = input.priceMinor;
  if (!Number.isInteger(price) || price <= 0) errors.priceMinor = "Indique un prix supérieur à zéro.";
  else if (input.currency === "CDF" && price % 100 !== 0) errors.priceMinor = "Le prix en francs doit être un nombre entier.";
  else if (input.currency === "USD" || input.currency === "CDF") {
    if (toUsdMinor(price, input.currency as Currency) > FEES.maxItemValueUsdMinor)
      errors.priceMinor = "Ce prix dépasse le maximum autorisé pour une annonce.";
  }
  if ((input.brand ?? "").length > 40) errors.brand = "La marque est limitée à 40 caractères.";
  if ((input.sizeLabel ?? "").length > 20) errors.sizeLabel = "La taille est limitée à 20 caractères.";
  const photos = input.photos ?? [];
  if (photos.length < 1) errors.photos = "Ajoute au moins une photo.";
  else if (photos.length > FEES.maxPhotos) errors.photos = `Tu peux ajouter ${FEES.maxPhotos} photos au maximum.`;
  return errors;
}
