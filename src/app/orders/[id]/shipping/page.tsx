import type { Metadata } from "next";
import { StubScreen } from "@/components/ui";
export const metadata: Metadata = { title: "Livraison" };
export default function Page() {
  return <StubScreen id="S10" title="Livraison" milestone="M2">La livraison par coursier local arrive après la remise en main propre.</StubScreen>;
}
