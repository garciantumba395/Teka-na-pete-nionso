import { describe, expect, it } from "vitest";
import { describeNotification, NOTIFICATION_KINDS, SMS_KIND_CATEGORY, smsText } from "../notifications";

describe("notifications : textes et liens", () => {
  const payload = { conversationId: "c1", orderId: "o1", disputeId: "d1", itemTitle: "Robe", senderName: "Marie", count: 3, role: "buyer" as const, rating: 5, until: 1_700_000_000_000 };

  it("chaque type a un titre et un détail en français, et un lien relatif au site ou aucun", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const d = describeNotification({ kind, payload });
      expect(d.title.length, kind).toBeGreaterThan(3);
      expect(d.body.length, kind).toBeGreaterThan(10);
      if (d.href !== null) expect(d.href, kind).toMatch(/^\/[a-z]/);
    }
  });

  it("le message regroupé indique le nombre de messages non lus ; le lien mène à la conversation", () => {
    const d = describeNotification({ kind: "message_received", payload });
    expect(d.body).toContain("3 messages non lus");
    expect(d.href).toBe("/inbox/c1");
    expect(describeNotification({ kind: "message_received", payload: { ...payload, count: 1 } }).body).not.toContain("non lus");
  });

  it("le signalement traité ne révèle aucune décision", () => {
    expect(describeNotification({ kind: "report_handled", payload: {} }).body).toBe("Merci pour ton signalement : notre équipe l'a traité.");
  });

  it("la fin de suspension s'affiche en fuseau fixe Africa/Kinshasa", () => {
    // 2023-11-14 22:13 UTC = 23:13 à Kinshasa (UTC+1) : même jour, quel que soit le fuseau du serveur
    expect(describeNotification({ kind: "suspension", payload: { until: Date.UTC(2023, 10, 14, 23, 30) } }).body).toContain("15 novembre 2023");
  });

  it("SMS : seulement le sous-ensemble critique, texte court sans chiffre ni donnée sensible", () => {
    expect(Object.keys(SMS_KIND_CATEGORY).sort()).toEqual(["dispute_opened", "dispute_resolved", "order_paid"]);
    for (const kind of NOTIFICATION_KINDS) {
      const t = smsText(kind);
      if (!(kind in SMS_KIND_CATEGORY)) expect(t, kind).toBeNull();
      else {
        expect(t!.length, kind).toBeLessThanOrEqual(160);
        expect(t, kind).not.toMatch(/\d/);
      }
    }
  });
});
