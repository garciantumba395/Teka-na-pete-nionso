import { describe, expect, it } from "vitest";
import { cleanLine, cleanText } from "../text";

const u = (...codes: number[]) => String.fromCharCode(...codes);

describe("nettoyage du texte saisi", () => {
  it("retire octet nul, contrôles, sens d'écriture, largeur nulle et demi-paires isolées", () => {
    expect(cleanLine("Robe" + u(0) + "nul")).toBe("Robenul");
    expect(cleanLine("Robe" + u(7) + "cloche")).toBe("Robecloche");
    expect(cleanLine("Robe" + u(0x202e) + "txet")).toBe("Robetxet");
    expect(cleanLine("Robe" + u(0xfeff) + "bom")).toBe("Robebom");
    expect(cleanLine("Robe" + u(0xd800) + "seul")).toBe("Robeseul");
    expect(cleanLine("a" + u(0x2028) + "b")).toBe("ab");
  });
  it("garde accents, emoji (paires valides) et retours à la ligne en texte long", () => {
    expect(cleanLine("Robe été 👗")).toBe("Robe été 👗");
    expect(cleanText("l1\r\nl2" + u(0))).toBe("l1\nl2");
    expect(cleanLine("l1\nl2")).toBe("l1 l2");
  });
});
