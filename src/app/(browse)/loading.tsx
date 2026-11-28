import { SkeletonGrid } from "@/components/ui";

export default function Loading() {
  return (
    <div className="page">
      <span className="skeleton" style={{ height: 48, borderRadius: "var(--radius-md)" }} aria-hidden="true" />
      <SkeletonGrid />
    </div>
  );
}
