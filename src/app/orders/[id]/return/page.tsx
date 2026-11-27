import type { Metadata } from "next";
import { StubScreen } from "@/components/ui";
export const metadata: Metadata = { title: "Retour d'un article" };
export default function Page() {
  return <StubScreen id="S12" title="Retour d'un article" milestone="M3" />;
}
