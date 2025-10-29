import "express-serve-static-core";
import type { PaymentContext } from "../middleware/payment.js";

declare module "express-serve-static-core" {
  interface BillingContext {
    mode: "credit" | "payment";
    priceMicros: number;
    priceUsd: number;
    description: string;
  }

  interface Request {
    senderWallet?: string;
    x402?: PaymentContext;
    billing?: BillingContext;
  }
}
