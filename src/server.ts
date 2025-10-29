import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";

import {
  paymentMiddleware,
  type FacilitatorAuthConfig,
  type PaymentRouteConfig,
} from "./middleware/payment.js";

import {
  consumeCredits,
  hasSufficientCredits,
  ledgerEnabled,
  recordPayment,
} from "@stream-for-change/gateway-ledger";

import { pricingConfig } from "./config/pricing.js";
import openaiRouter from "./routes/openai.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 3000);
const DEFAULT_WALLET = "9rKmtdWDHGmi3xqyvTM23Bps5wUwg2oB7Y9HAseRrxqv";
const payToAddress = process.env.X402_GATEWAY_WALLET ?? DEFAULT_WALLET;

const facilitatorConfig = buildFacilitatorConfig();
const paymentGuard = paymentMiddleware(payToAddress, pricingConfig, facilitatorConfig);

function buildFacilitatorConfig(): FacilitatorAuthConfig | undefined {
  const facilitatorUrl = process.env.FACILITATOR_URL;
  if (!facilitatorUrl) {
    return undefined;
  }

  return {
    url: facilitatorUrl,
    apiKey: process.env.FACILITATOR_API_KEY,
  };
}

function findRouteConfig(method: string, path: string): PaymentRouteConfig | undefined {
  const key = `${method.toUpperCase()} ${path}`;
  return pricingConfig[key];
}

function toMicros(amountUsd: number): number {
  return Math.round(amountUsd * 1_000_000);
}

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/") {
    next();
    return;
  }

  const senderWalletHeader =
    (req.headers["x402-sender-wallet"] as string | undefined) ??
    (typeof req.body?.senderWallet === "string" ? req.body.senderWallet : undefined);

  if (!senderWalletHeader || senderWalletHeader.trim().length === 0) {
    res.status(400).json({
      error: "missing_sender_wallet",
      message:
        "Provide the wallet address you will use for payments via the `x402-sender-wallet` header or `senderWallet` field.",
    });
    return;
  }

  req.senderWallet = senderWalletHeader.trim();
  next();
});

app.use(async (req: Request, res: Response, next: NextFunction) => {
  const routeConfig = findRouteConfig(req.method, req.path);
  if (!routeConfig) {
    next();
    return;
  }

  const wallet = req.senderWallet;
  if (!wallet) {
    res.status(400).json({
      error: "missing_sender_wallet",
      message: "Sender wallet is required to process billing.",
    });
    return;
  }

  const priceMicros = toMicros(routeConfig.priceUsd);

  req.billing = {
    mode: "payment",
    priceMicros,
    priceUsd: routeConfig.priceUsd,
    description: routeConfig.description,
  };

  if (!ledgerEnabled()) {
    next();
    return;
  }

  try {
    const { hasCredit } = await hasSufficientCredits(wallet, priceMicros);
    if (hasCredit) {
      req.billing.mode = "credit";

      res.once("finish", () => {
        if (res.statusCode >= 400) {
          return;
        }

        void consumeCredits({
          wallet,
          amountMicros: priceMicros,
          endpoint: `${req.method.toUpperCase()} ${req.path}`,
          description: routeConfig.description,
          billingMode: "credit",
          metadata: {
            requestPath: req.originalUrl,
          },
        }).catch((error: unknown) => {
          console.error("Failed to consume stored credits", error);
        });
      });

      next();
      return;
    }
  } catch (error: unknown) {
    console.error("Credit balance lookup failed", error);
  }

  res.once("finish", () => {
    if (res.statusCode >= 400) {
      return;
    }

    const paymentContext = req.x402;
    if (!paymentContext?.settleResponse) {
      console.warn("Payment completed without settlement context; skipping ledger update");
      return;
    }

    const payer =
      (paymentContext.settleResponse as Record<string, unknown>)?.payer ??
      paymentContext.verifyResponse?.payer;
    if (typeof payer === "string" && payer !== wallet) {
      console.warn(
        `Payer mismatch detected. Declared wallet ${wallet} differs from payment payer ${payer}.`,
      );
    }

    (async () => {
      await recordPayment({
        wallet,
        amountMicros: priceMicros,
        resource: req.originalUrl,
        paymentPayload: paymentContext.paymentPayload,
        verifyResponse: paymentContext.verifyResponse,
        settleResponse: paymentContext.settleResponse,
      });

      await consumeCredits({
        wallet,
        amountMicros: priceMicros,
        endpoint: `${req.method.toUpperCase()} ${req.path}`,
        description: routeConfig.description,
        billingMode: "payment",
        metadata: {
          requestPath: req.originalUrl,
        },
      });
    })().catch((error: unknown) => {
      console.error("Failed to finalize payment ledger", error);
    });
  });

  next();
});

app.use(paymentGuard);

app.get("/", (_req, res) => {
  res.json({
    message: "👋 Welcome to the x402 Marketplace API Gateway.",
    description:
      "Instant pay-per-use access to top APIs using the x402 protocol — starting with OpenAI.",
    status: "online",
    version: "1.0.0",
    payment_instructions: {
      how_to_pay: "Before using any endpoint, pay via the x402 protocol to unlock access.",
      step_1: "Send your payment to the x402 Gateway wallet address:",
      wallet_address: payToAddress,
      step_2: "Include your request hash or session ID in the memo field for verification.",
      step_3:
        "Once payment is confirmed on-chain, retry your API call — the gateway will verify it automatically.",
      accepted_currencies: ["USDC", "SOL", "$402MARKET"],
      note: "Each call or session requires a valid on-chain payment. Unpaid requests will receive an HTTP 402 Payment Required response.",
    },
    available_endpoints: {
      openai_completions: "/openai/completions",
      openai_chat_completions: "/openai/chat/completions",
      openai_images: "/openai/images/generations",
      openai_models: "/openai/models",
    },
    disclaimer:
      "x402 Marketplace acts as a payment-gated proxy layer for third-party APIs. Payments are verified on-chain and non-refundable.",
  });
});

app.use("/openai", openaiRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Not Found", path: req.path });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unexpected error", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`x402 OpenAI gateway running on port ${PORT}`);
});
