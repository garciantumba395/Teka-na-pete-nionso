import { describe, expect, it } from "vitest";
import { formatMoney, parseMoneyInput, toUsdMinor } from "../money";
import { payoutFee, protectionFee } from "../fees";
import {
  assertBalanced,
  holdEntries,
  payoutFailedEntries,
  payoutPaidEntries,
  payoutRequestEntries,
  refundEntries,
  releaseEntries,
  sellerAvailable,
  type NewEntry,
} from "../ledger";
import { canTransition } from "../fsm";
import { checkAttempt, codesEqual, deriveHandoverCode, hashCode } from "../handover";
import { normalizeDrcPhone } from "../phone";
import { coarsen, distanceKm } from "../geo";
import { validateListing } from "../validation";
import type { Category, LedgerEntry, OrderStatus } from "../types";

const NB = " ";
const ctx = { txnId: "t1", currency: "USD" as const, refType: "order" as const, refId: "o1" };

describe("money", () => {
  it("formate USD et CDF", () => {
    expect(formatMoney(1250, "USD")).toBe(`12,50${NB}$`);
    expect(formatMoney(800, "USD")).toBe(`8${NB}$`);
    expect(formatMoney(3_500_000, "CDF")).toBe(`35${NB}000${NB}FC`);
    expect(formatMoney(125_000_000, "CDF")).toBe(`1${NB}250${NB}000${NB}FC`);
  });
  it("lit les saisies", () => {
    expect(parseMoneyInput("12,5", "USD")).toBe(1250);
    expect(parseMoneyInput("35 000", "CDF")).toBe(3_500_000);
    expect(parseMoneyInput("35 000,5", "CDF")).toBeNull();
    expect(parseMoneyInput("abc", "USD")).toBeNull();
    expect(parseMoneyInput("0", "USD")).toBeNull();
    expect(parseMoneyInput("-5", "USD")).toBeNull();
  });
  it("convertit en USD pour le plafond", () => {
    expect(toUsdMinor(5000, "USD")).toBe(5000);
    expect(toUsdMinor(2800 * 100, "CDF")).toBe(100);
  });
});

describe("fees", () => {
  it("applique le minimum fixe puis le pourcentage", () => {
    expect(protectionFee(100, "USD")).toBe(50); // 5 % = 5 cents < minimum 50
    expect(protectionFee(10_000, "USD")).toBe(500); // 5 % de 100 $
  });
  it("calcule les frais de retrait", () => {
    expect(payoutFee(10_000)).toBe(100);
  });
});

describe("grand livre", () => {
  const params = { sellerId: "s1", itemsMinor: 2500, shippingMinor: 0, feeMinor: 125 };
  it("chaque type d'écriture est équilibré", () => {
    const total = 2625;
    for (const entries of [
      holdEntries(ctx, total),
      releaseEntries(ctx, params),
      refundEntries(ctx, total),
      payoutRequestEntries(ctx, { userId: "s1", amountMinor: 1000, feeMinor: 10 }),
      payoutPaidEntries(ctx, { userId: "s1", amountMinor: 1000 }),
      payoutFailedEntries(ctx, { userId: "s1", amountMinor: 1000, feeMinor: 10 }),
    ]) {
      expect(() => assertBalanced(entries)).not.toThrow();
      expect(entries.every((x) => x.amountMinor !== 0)).toBe(true);
    }
  });
  it("refuse une transaction déséquilibrée", () => {
    const bad: NewEntry[] = [
      { txnId: "x", account: "psp_clearing", userId: null, currency: "USD", amountMinor: 100, refType: "adjustment", refId: "r" },
    ];
    expect(() => assertBalanced(bad)).toThrow(/déséquilibrée/);
  });
  it("le solde vendeur = articles libérés - retraits", () => {
    const all: LedgerEntry[] = [
      ...releaseEntries(ctx, params),
      ...payoutRequestEntries({ ...ctx, txnId: "t2" }, { userId: "s1", amountMinor: 1000, feeMinor: 10 }),
    ].map((x, i) => ({ ...x, id: String(i), createdAt: 0 }));
    expect(sellerAvailable(all, "s1", "USD")).toBe(2500 - 1010);
  });
  it("libération + remboursement ne peuvent pas coexister sans trace (escrow revient à zéro)", () => {
    const entries = [...holdEntries(ctx, 2625), ...refundEntries({ ...ctx, txnId: "t3" }, 2625)];
    const escrow = entries.filter((x) => x.account === "order_escrow").reduce((s, x) => s + x.amountMinor, 0);
    expect(escrow).toBe(0);
  });
});

describe("machine d'états des commandes", () => {
  const all: OrderStatus[] = [
    "pending_payment", "paid", "in_delivery", "delivered", "completed", "disputed", "refunded", "cancelled", "expired",
  ];
  it("autorise le chemin nominal", () => {
    expect(canTransition("pending_payment", "paid")).toBe(true);
    expect(canTransition("paid", "delivered")).toBe(true);
    expect(canTransition("delivered", "completed")).toBe(true);
  });
  it("interdit les sauts et les sorties d'états terminaux", () => {
    expect(canTransition("pending_payment", "completed")).toBe(false);
    expect(canTransition("expired", "paid")).toBe(false);
    for (const t of ["completed", "refunded", "cancelled", "expired"] as OrderStatus[])
      for (const to of all) if (to !== t) expect(canTransition(t, to)).toBe(false);
  });
});

describe("code de remise", () => {
  it("est déterministe, à 6 chiffres, propre à la commande", () => {
    const a = deriveHandoverCode("order-a", "s");
    expect(a).toMatch(/^\d{6}$/);
    expect(deriveHandoverCode("order-a", "s")).toBe(a);
    expect(deriveHandoverCode("order-b", "s")).not.toBe(a);
    expect(deriveHandoverCode("order-a", "autre")).not.toBe(a);
    expect(hashCode(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(codesEqual(a, a)).toBe(true);
    expect(codesEqual(a, "000000x")).toBe(false);
  });
  it("verrouille après 5 essais faux, puis se déverrouille", () => {
    let s = { attempts: 0, lockedUntil: null as number | null };
    const now = 1_000;
    for (let i = 1; i <= 4; i++) {
      const r = checkAttempt(s, false, now, 5, 900_000);
      expect(r.result).toBe("wrong");
      s = r.state;
    }
    const fifth = checkAttempt(s, false, now, 5, 900_000);
    expect(fifth.result).toBe("locked");
    s = fifth.state;
    expect(checkAttempt(s, true, now + 10, 5, 900_000).result).toBe("locked"); // même un bon code est refusé
    expect(checkAttempt(s, true, now + 900_001, 5, 900_000).result).toBe("ok");
  });
  it("un bon code remet le compteur à zéro", () => {
    const r1 = checkAttempt({ attempts: 3, lockedUntil: null }, true, 0, 5, 1);
    expect(r1.state.attempts).toBe(0);
  });
});

describe("téléphone RDC", () => {
  it("normalise les formes courantes", () => {
    for (const v of ["+243 81 234 5678", "0812345678", "812345678", "00243812345678", "243812345678"])
      expect(normalizeDrcPhone(v)).toBe("+243812345678");
  });
  it("rejette les numéros invalides", () => {
    for (const v of ["", "12345", "0712345678", "+33612345678", "08123456789"]) expect(normalizeDrcPhone(v)).toBeNull();
  });
});

describe("géographie", () => {
  it("donne la même distance que distance_km() en SQL", () => {
    expect(distanceKm(-4.303, 15.307, -4.34, 15.35)).toBeCloseTo(6.3, 1);
    expect(distanceKm(-4.303, 15.307, -11.66, 27.48)).toBeGreaterThan(1000);
  });
  it("arrondit à 0,01°", () => {
    expect(coarsen(-4.30384)).toBe(-4.3);
    expect(coarsen(15.3079)).toBe(15.31);
  });
});

describe("validation d'annonce", () => {
  const cats: Category[] = [
    { id: "c1", parentId: null, slug: "robes", name: "Robes", isSellable: true },
    { id: "c0", parentId: null, slug: "femme", name: "Femme", isSellable: false },
  ];
  const ok = { title: "Robe wax", description: "", categoryId: "c1", condition: "good", priceMinor: 2500, currency: "USD", photos: ["a"] };
  it("accepte une annonce valide", () => expect(validateListing(ok, cats)).toEqual({}));
  it("refuse titre court, catégorie non vendable, sans photo", () => {
    const e = validateListing({ ...ok, title: "ab", categoryId: "c0", photos: [] }, cats);
    expect(Object.keys(e).sort()).toEqual(["categoryId", "photos", "title"]);
  });
  it("applique le plafond de valeur dans les deux devises", () => {
    expect(validateListing({ ...ok, priceMinor: 100_001 }, cats).priceMinor).toMatch(/maximum/);
    expect(validateListing({ ...ok, currency: "CDF", priceMinor: 2800 * 100_001 }, cats).priceMinor).toMatch(/maximum/);
    expect(validateListing({ ...ok, currency: "CDF", priceMinor: 3_500_000 }, cats)).toEqual({});
  });
  it("exige des francs entiers et au plus 20 photos", () => {
    expect(validateListing({ ...ok, currency: "CDF", priceMinor: 3_500_050 }, cats).priceMinor).toMatch(/entier/);
    expect(validateListing({ ...ok, photos: Array(21).fill("a") }, cats).photos).toMatch(/20/);
  });
});
