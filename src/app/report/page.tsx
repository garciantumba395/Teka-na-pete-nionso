import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ReportForm } from "@/components/client/ReportForm";
import { AppBar } from "@/components/ui";
import { getData } from "@/lib/data";
import { parseIdOrNull } from "@/lib/schemas";
import { currentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Signaler" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const type = one(sp.type);
  const id = one(sp.id);
  if ((type !== "item" && type !== "user") || !parseIdOrNull(id)) notFound();
  const me = await currentUser();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/report?type=${type}&id=${id}`)}`);
  const data = getData();
  let label = "";
  let back = "/";
  if (type === "item") {
    const it = await data.getItem(id, me.id);
    if (!it) notFound();
    label = it.title;
    back = `/items/${id}`;
  } else {
    const p = await data.getPublicProfile(id);
    if (!p) notFound();
    label = p.displayName;
    back = `/members/${id}`;
  }
  return (
    <div className="narrow">
      <AppBar title="Signaler" back={back} />
      <div className="pad">
        <ReportForm targetType={type} targetId={id} targetLabel={label} back={back} />
      </div>
    </div>
  );
}
