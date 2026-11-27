import { createFakeData } from "../data/fake";
import { defineContract } from "./contract";

defineContract("couche factice", async () => {
  let t = 1_700_000_000_000;
  const data = createFakeData({ now: () => t, autoComplete: false });
  return {
    data,
    now: () => t,
    advance: (ms) => { t += ms; },
    ledger: async () => data.__ledger(),
    pendingEvents: async () => data.__pendingEvents(),
    flush: () => data.__flush(),
    refunds: () => data.__provider.refunds.length,
  };
});
