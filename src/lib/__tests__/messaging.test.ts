import { describe, expect, it } from "vitest";
import { detectOffPlatform } from "../messaging";

describe("détection des échanges hors plateforme", () => {
  it("repère un numéro, quel que soit le format", () => {
    for (const t of ["Appelle le 0821234567", "mon num 082 123 45 67", "+243 82 123 4567", "082-123-45-67", "whatsapp: 0.8.2.1.2.3.4.5.6.7".replace(/\./g, " ")]) expect(detectOffPlatform(t), t).toBe("phone");
  });
  it("repère un lien", () => {
    for (const t of ["https://exemple.com/x", "www.exemple.cd", "va sur monsite.com"]) expect(detectOffPlatform(t), t).toBe("link");
  });
  it("ne signale pas un message ordinaire, un prix ou une date", () => {
    for (const t of ["Bonjour, il est encore disponible ?", "Je propose 25 dollars", "Rendez-vous le 12/03 à 14h30", "Taille 38, état 9/10", "Merci. À demain !"]) expect(detectOffPlatform(t), t).toBeNull();
  });
});
