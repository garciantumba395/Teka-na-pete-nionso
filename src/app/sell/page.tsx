import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SellForm } from "@/components/client/SellForm";
import { AppBar } from "@/components/ui";
import { getData } from "@/lib/data";
import { seedId } from "@/lib/data/ids";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Vendre un article" };

export default async function SellPage() {
  const me = await currentUser();
  if (!me) redirect("/signin?next=/sell");
  const data = getData();
  const [categories, areas] = await Promise.all([data.listCategories(), data.listAreas(seedId("area-prov-kinshasa"))]);
  return (
    <div className="narrow">
      <AppBar title="Vendre un article" back="/" />
      <div className="pad">
        <SellForm categories={categories} areas={areas} defaultAreaId={me.areaId} />
      </div>
    </div>
  );
}
