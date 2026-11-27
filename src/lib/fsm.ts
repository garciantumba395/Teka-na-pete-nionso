import type { OrderStatus } from "./types";

// Même table que le trigger orders_guard_transition de replica/schema.sql.
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled", "expired"],
  paid: ["in_delivery", "delivered", "cancelled", "disputed"],
  in_delivery: ["delivered", "disputed", "cancelled"],
  delivered: ["completed", "disputed"],
  disputed: ["completed", "refunded"],
  completed: [],
  refunded: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new Error(`Transition de commande invalide : ${from} -> ${to}`);
}

export const TERMINAL: OrderStatus[] = ["completed", "refunded", "cancelled", "expired"];
