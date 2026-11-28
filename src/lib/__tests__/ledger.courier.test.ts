import { describe, expect, it } from "vitest";
import { FEES } from "../fees";
import { assertBalanced, courierSettleEntries, holdEntries, refundEntries, releaseEntries, sellerAvailable, type NewEntry } from "../ledger";
import { feesFromSettings } from "../data/pg/settings";
import type { LedgerEntry } from "../types";

// agent G : qui règle le coursier ? Domaine du grand livre, sans base de données.
const ctx = (txnId: string, currency: "USD" | "CDF" = "USD") => ({ txnId, currency, refType: "order" as const, refId: "o1" });
const P = { sellerId: "s1", itemsMinor: 2500, shippingMinor: 400, feeMinor: 125 };
const sum = (xs: NewEntry[], account: string) => xs.filter((x) => x.account === account).reduce((s, x) => s + x.amountMinor, 0);
const withIds = (xs: NewEntry[]): LedgerEntry[] => xs.map((x, i) => ({ ...x, id: String(i), createdAt: 0 }));

describe("libération : mode « seller » (défaut)", () => {
  const out = releaseEntries(ctx("t1"), P);
  it("est équilibrée et ne touche pas shipping_payable", () => {
    expect(() => assertBalanced(out)).not.toThrow();
    expect(sum(out, "shipping_payable")).toBe(0);
    expect(sum(out, "order_escrow")).toBe(P.itemsMinor + P.shippingMinor + P.feeMinor);
  });
  it("verse articles + livraison au vendeur, en deux lignes distinctes (articles : order, livraison : order_shipping)", () => {
    const mine = out.filter((x) => x.account === "seller_available");
    expect(mine.map((x) => [x.refType, x.amountMinor, x.userId])).toEqual([["order", -2500, "s1"], ["order_shipping", -400, "s1"]]);
    expect(sellerAvailable(withIds(out), "s1", "USD")).toBe(2900);
  });
  it("sans mode précisé, le comportement est « seller »", () => {
    expect(releaseEntries(ctx("t1"), { ...P, courierFeeMode: "seller" })).toEqual(out);
  });
  it("sans frais de livraison (remise en main propre) : aucune ligne de livraison, aucune ligne à zéro", () => {
    const e = releaseEntries(ctx("t1"), { ...P, shippingMinor: 0 });
    expect(e.some((x) => x.refType === "order_shipping" || x.account === "shipping_payable")).toBe(false);
    expect(e.every((x) => x.amountMinor !== 0)).toBe(true);
    expect(() => assertBalanced(e)).not.toThrow();
  });
});

describe("libération : mode « platform »", () => {
  const out = releaseEntries(ctx("t1"), { ...P, courierFeeMode: "platform" });
  it("garde la livraison sur shipping_payable et ne verse que les articles au vendeur", () => {
    expect(() => assertBalanced(out)).not.toThrow();
    expect(sum(out, "shipping_payable")).toBe(-400);
    expect(sellerAvailable(withIds(out), "s1", "USD")).toBe(2500);
    expect(out.some((x) => x.refType === "order_shipping")).toBe(false);
  });
  it("le règlement du coursier solde exactement shipping_payable vers courier_paid, en écriture équilibrée", () => {
    const settle = courierSettleEntries(ctx("t2"), 400);
    expect(() => assertBalanced(settle)).not.toThrow();
    expect(settle.map((x) => [x.account, x.amountMinor])).toEqual([["shipping_payable", 400], ["courier_paid", -400]]);
    expect(sum([...out, ...settle], "shipping_payable")).toBe(0);
  });
  it("règlement à zéro : aucune écriture", () => {
    expect(courierSettleEntries(ctx("t2"), 0)).toEqual([]);
  });
});

describe("par devise", () => {
  it("USD et CDF s'équilibrent séparément, dans les deux modes, remboursement compris", () => {
    for (const mode of ["seller", "platform"] as const) {
      const all = [
        ...holdEntries(ctx("a"), 3025), ...releaseEntries(ctx("b"), { ...P, courierFeeMode: mode }),
        ...holdEntries(ctx("c", "CDF"), 6_600_000), ...releaseEntries(ctx("d", "CDF"), { sellerId: "s2", itemsMinor: 5_000_000, shippingMinor: 1_000_000, feeMinor: 600_000, courierFeeMode: mode }),
        ...holdEntries(ctx("e"), 3025), ...refundEntries(ctx("f"), 3025),
      ];
      expect(() => assertBalanced(all)).not.toThrow();
      for (const cur of ["USD", "CDF"] as const) expect(all.filter((x) => x.currency === cur).reduce((s, x) => s + x.amountMinor, 0)).toBe(0);
    }
  });
});

describe("réglage courier_fee_mode", () => {
  it("vaut « seller » par défaut, absent ou invalide", () => {
    expect(FEES.courierFeeMode).toBe("seller");
    expect(feesFromSettings([]).courierFeeMode).toBe("seller");
    expect(feesFromSettings([{ key: "courier_fee_mode", value: "n'importe quoi" }]).courierFeeMode).toBe("seller");
    expect(feesFromSettings([{ key: "courier_fee_mode", value: 3 }]).courierFeeMode).toBe("seller");
  });
  it("lit « platform » et « seller » depuis la table settings", () => {
    expect(feesFromSettings([{ key: "courier_fee_mode", value: "platform" }]).courierFeeMode).toBe("platform");
    expect(feesFromSettings([{ key: "courier_fee_mode", value: "seller" }]).courierFeeMode).toBe("seller");
  });
});
