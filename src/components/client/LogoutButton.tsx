"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-secondary"
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/auth/logout", { body: {} });
        } finally {
          router.push("/");
          router.refresh();
        }
      }}
    >
      Me déconnecter
    </button>
  );
}
