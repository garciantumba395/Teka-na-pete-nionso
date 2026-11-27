import type { Metadata } from "next";
import { StubScreen } from "@/components/ui";
export const metadata: Metadata = { title: "Messages" };
export default function Page() {
  return <StubScreen id="S07" title="Messages" milestone="M1">Pour l&apos;instant, la remise se règle avec le code de remise après paiement.</StubScreen>;
}
