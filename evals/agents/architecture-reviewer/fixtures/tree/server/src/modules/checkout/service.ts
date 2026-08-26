import { priceOrder } from "./domain/checkout.js";

export class CheckoutService {
  async checkout(order: { id: string; total: number }) {
    const price = priceOrder(order);
    return { price };
  }
}
