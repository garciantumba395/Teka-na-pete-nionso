"use client";

import { useEffect } from "react";

/** Marque <html data-hydrated="1"> une fois la page interactive (utile aux tests de bout en bout). */
export function Hydrated() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1";
  }, []);
  return null;
}
