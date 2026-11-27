import { describe, expect, it } from "vitest";
import { FEES, shippingFee, shippingZone } from "../fees";
import { resolveAsOf } from "../jobs";
import { feesFromSettings } from "../data/pg/settings";
import { canTransition } from "../fsm";
import { releaseEntries, assertBalanced } from "../ledger";

describe("livraison par coursier : règles pures", () => {
  const areas = [
    { id: "gombe", parentId: "kin" }, { id: "limete", parentId: "kin" }, { id: "lubum", parentId: "kat" }, { id: "orphan", parentId: null },
  ];
  it("zone : même commune, même ville, autre ville ; origine inconnue ou sans parent : même ville au plus", () => {
    expect(shippingZone("gombe", "gombe", areas)).toBe("sameCommune");
    expect(shippingZone("gombe", "limete", areas)).toBe("sameCity");
    expect(shippingZone("gombe", "lubum", areas)).toBe("otherCity");
    expect(shippingZone(null, "limete", areas)).toBe("sameCity");
    expect(shippingZone("orphan", "limete", areas)).toBe("otherCity");
  });
  it("grille : plus c'est loin, plus c'est cher, dans les deux devises", () => {
    for (const cur of ["USD", "CDF"] as const) {
      expect(shippingFee("sameCommune", cur)).toBeLessThan(shippingFee("sameCity", cur));
      expect(shippingFee("sameCity", cur)).toBeLessThan(shippingFee("otherCity", cur));
    }
  });
  it("paramètres : valeurs par défaut sans réglage, surcharge partielle de la grille, délais en heures et en jours", () => {
    expect(feesFromSettings([]).shippingGrid).toEqual(FEES.shippingGrid);
    expect(feesFromSettings([]).claimWindowMs).toBe(FEES.claimWindowMs);
    const cfg = feesFromSettings([
      { key: "shipping_grid", value: { sameCity: { USD: 999 }, otherCity: "n'importe quoi" } },
      { key: "claim_window_hours", value: 24 }, { key: "courier_stale_days", value: 3 },
    ]);
    expect(cfg.shippingGrid.sameCity).toEqual({ USD: 999, CDF: FEES.shippingGrid.sameCity.CDF });
    expect(cfg.shippingGrid.otherCity).toEqual(FEES.shippingGrid.otherCity);
    expect(cfg.claimWindowMs).toBe(24 * 3_600_000);
    expect(cfg.courierStaleMs).toBe(3 * 86_400_000);
  });
  it("l'horloge simulée des tâches est refusée en production", () => {
    expect(resolveAsOf(null, "production")).toBeUndefined();
    expect(() => resolveAsOf("1700000000000", "production")).toThrow();
    expect(resolveAsOf("1700000000000", "development")).toEqual({ at: 1_700_000_000_000 });
    expect(() => resolveAsOf("abc", "development")).toThrow();
    expect(() => resolveAsOf("-5", "development")).toThrow();
  });
  it("automate : livrée -> litige autorisé, livrée -> remboursée interdit (il faut passer par le litige)", () => {
    expect(canTransition("delivered", "disputed")).toBe(true);
    expect(canTransition("delivered", "completed")).toBe(true);
    expect(canTransition("delivered", "refunded")).toBe(false);
    expect(canTransition("in_delivery", "delivered")).toBe(true);
  });
  it("grand livre : libération avec livraison équilibrée, la livraison va au compte « à payer aux coursiers »", () => {
    const e = releaseEntries({ txnId: "t", currency: "USD", refType: "order", refId: "o" }, { sellerId: "s", itemsMinor: 10_000, shippingMinor: 400, feeMinor: 500 });
    expect(() => assertBalanced(e)).not.toThrow();
    expect(e.find((x) => x.account === "shipping_payable")?.amountMinor).toBe(-400);
  });
});
