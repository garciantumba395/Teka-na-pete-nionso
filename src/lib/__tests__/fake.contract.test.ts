import { createFakeData } from "../data/fake";
import { ConsoleSmsProvider } from "../sms/provider";
import { defineContract } from "./contract";

process.env.SMS_CONSOLE_QUIET = "1";

defineContract("couche factice", async () => {
  let t = 1_700_000_000_000;
  const sms = new ConsoleSmsProvider();
  const data = createFakeData({ now: () => t, autoComplete: false, sms });
  return {
    data,
    now: () => t,
    advance: (ms) => { t += ms; },
    ledger: async () => data.__ledger(),
    pendingEvents: async () => data.__pendingEvents(),
    flush: () => data.__flush(),
    refunds: () => data.__provider.refunds.length,
    sentSms: () => sms.sent,
    settleSms: () => data.__settleSms(),
  };
});
