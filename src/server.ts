import { readFileSync } from "node:fs";

import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";

import {
  paymentMiddleware,
  type FacilitatorAuthConfig,
  type PaymentRouteConfig,
} from "./middleware/payment.js";

import { createFacilitatorRouter } from "./facilitator/router.js";
import { createAdminRouter } from "./routes/admin.js";

import {
  consumeCredits,
  hasSufficientCredits,
  ledgerEnabled,
  recordPayment,
} from "@stream-for-change/gateway-ledger";

import { pricingConfig } from "./config/pricing.js";
import openaiRouter from "./routes/openai.js";

dotenv.config();

const FALLBACK_SVM_PRIVATE_KEY =
  "565SiaKZbkhdYQ6mCykuxx933qT2gSnDMWJo9L8e27PM6hYw1zbfXH9SbbzHuZajEuvABGymQKSWqyR1FAqtLRTG";

function loadSvmPrivateKey(): string {
  const direct = process.env.SVM_PRIVATE_KEY;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }

  const base64 = process.env.SVM_PRIVATE_KEY_BASE64 ?? process.env.SVM_PRIVATE_KEY_B64;
  if (typeof base64 === "string" && base64.trim().length > 0) {
    try {
      const decoded = Buffer.from(base64.trim(), "base64").toString("utf-8").trim();
      if (decoded.length > 0) {
        return decoded;
      }
    } catch (error) {
      console.error("Failed to decode SVM_PRIVATE_KEY_BASE64", error);
    }
  }

  const filePath = process.env.SVM_PRIVATE_KEY_FILE ?? process.env.SVM_PRIVATE_KEY_PATH;
  if (typeof filePath === "string" && filePath.trim().length > 0) {
    try {
      const fileContents = readFileSync(filePath.trim(), "utf-8").trim();
      if (fileContents.length > 0) {
        return fileContents;
      }

      console.warn(`SVM private key file at '${filePath}' is empty.`);
    } catch (error) {
      console.error(`Failed to read SVM private key file at '${filePath}'`, error);
    }
  }

  return FALLBACK_SVM_PRIVATE_KEY;
}

const PORT = Number(process.env.PORT ?? 3000);
const NODE_ENV = process.env.NODE_ENV ?? "development";
const DEFAULT_WALLET = "9rKmtdWDHGmi3xqyvTM23Bps5wUwg2oB7Y9HAseRrxqv";
const payToAddress = process.env.X402_GATEWAY_WALLET ?? DEFAULT_WALLET;
const facilitatorApiKey = process.env.FACILITATOR_API_KEY;
const heliusApiKey = process.env.HELIUS_API_KEY;
const svmRpcUrl =
  process.env.SVM_RPC_URL ??
  (heliusApiKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}` : undefined);
const svmPrivateKey = loadSvmPrivateKey();
const defaultTestPayerWallet = "7FHxcYUCcyFmh35froTpsHa9YwA5euALXFaH7ykVATYh";
const testPayerPrivateKey = process.env.TEST_PAYER_PRIVATE_KEY;
const testPayerWallet = (process.env.TEST_PAYER_WALLET ?? defaultTestPayerWallet).trim();
const defaultFacilitatorUrl =
  NODE_ENV === "production"
    ? "https://x402market.app/facilitator"
    : `http://localhost:${PORT}/facilitator`;
const facilitatorUrl = process.env.FACILITATOR_URL ?? defaultFacilitatorUrl;
const gatewayBaseUrl =
  NODE_ENV === "production" ? "https://x402market.app" : `http://localhost:${PORT}`;
const x402Config = svmRpcUrl ? { svmConfig: { rpcUrl: svmRpcUrl } } : undefined;

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(
  "/admin",
  createAdminRouter({
    testPayerPrivateKey,
    testPayerWallet,
    gatewayBaseUrl,
    x402Config,
  }),
);

try {
  const facilitatorRouter = createFacilitatorRouter({
    apiKey: facilitatorApiKey,
    svmPrivateKey,
    svmRpcUrl,
  });
  app.use("/facilitator", facilitatorRouter);
  console.log("Facilitator router initialised");
} catch (error) {
  console.error("Failed to initialise facilitator router", error);
  process.exit(1);
}

const facilitatorConfig = buildFacilitatorConfig();
const paymentGuard = paymentMiddleware(payToAddress, pricingConfig, facilitatorConfig);

function buildFacilitatorConfig(): FacilitatorAuthConfig {
  return {
    url: facilitatorUrl,
    apiKey: facilitatorApiKey,
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
  if (req.path.startsWith("/facilitator")) {
    next();
    return;
  }

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
  if (req.path.startsWith("/facilitator")) {
    next();
    return;
  }

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
      overview:
        "Every request is pay-per-use. Your first call collects a 402 challenge, then you retry with an X-PAYMENT header that proves settlement on Solana.",
      gateway_wallet: payToAddress,
      initial_call: {
        description:
          "Send the request without an X-PAYMENT header to obtain pricing and payment requirements. You will receive HTTP 402 with the structured challenge payload.",
        example_curl: `curl -i ${gatewayBaseUrl}/openai/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'x402-sender-wallet: <YOUR_SOLANA_ADDRESS>' \
  -d '{ "model": "gpt-4o-mini", "messages": [{ "role": "user", "content": "say hello" }] }'`,
      },
      payment_challenge: {
        description:
          "The 402 response body contains PaymentRequirements. Persist it — you must echo these exact fields when constructing the second attempt.",
        example_402_response: {
          status: 402,
          body: {
            x402Version: 1,
            error: "X-PAYMENT header is required",
            accepts: [
              {
                network: "solana",
                scheme: "exact",
                payTo: payToAddress,
                amountUsd: "<calculated>",
                memo: "<opaque session identifier>",
              },
            ],
          },
        },
      },
      second_attempt: {
        description:
          "Create a signer for your Solana wallet, pay the stated amount, encode the signed payment JSON as base64, and retry the identical request with the X-PAYMENT header.",
        headers_required: ["x402-sender-wallet", "X-PAYMENT"],
        curl_example: `curl -i ${gatewayBaseUrl}/openai/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'x402-sender-wallet: <YOUR_SOLANA_ADDRESS>' \
  -H 'X-PAYMENT: <BASE64_PAYMENT_HEADER>' \
  -d '{ "model": "gpt-4o-mini", "messages": [{ "role": "user", "content": "say hello" }] }'`,
        node_example: [
          "import { createSigner } from \"x402/types\";",
          "import { createPaymentHeader } from \"x402/client\";",
          "",
          "const signer = await createSigner(\"solana\", process.env.SVM_PRIVATE_KEY!);",
          "const header = await createPaymentHeader(signer, 1, paymentRequirements);",
          `const response = await fetch("${gatewayBaseUrl}/openai/chat/completions", {`,

          "  method: \"POST\",",
          "  headers: {",
          "    \"content-type\": \"application/json\",",
          "    \"x402-sender-wallet\": signer.address,",
          "    \"X-PAYMENT\": header,",
          "  },",
          "  body: JSON.stringify(payload),",
          "});",
        ],
        payment_payload_template: {
          paymentPayload: "<Signed payment payload from your facilitator>",
          paymentRequirements: "<Exact object returned in the initial 402 response>",
        },
      },
      tips: [
        "Ensure the wallet that signs the payment matches the `x402-sender-wallet` header.",
        "Reuse the payment receipt for additional calls until the credited balance is exhausted.",
        "Always base64-encode the full JSON envelope when setting the `X-PAYMENT` header.",
      ],
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
