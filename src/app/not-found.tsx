import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="page narrow">
      <EmptyState icon="search" title="Page introuvable" action={<Link className="btn btn-primary" href="/">Retour à l&apos;accueil</Link>}>
        Le lien est peut-être ancien, ou l&apos;annonce a été retirée.
      </EmptyState>
    </div>
  );
}
