export interface CheckoutOrder {
  id: string;
  total: number;
}

export function priceOrder(order: CheckoutOrder): number {
  return order.total;
}
