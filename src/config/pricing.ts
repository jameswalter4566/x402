import type { PaymentRoutesConfig } from "../middleware/payment.js";

export const pricingConfig: PaymentRoutesConfig = {
  "POST /openai/completions": {
    priceUsd: 0.05,
    network: "solana",
    description: "OpenAI text completions",
    mimeType: "application/json",
  },
  "POST /openai/chat/completions": {
    priceUsd: 0.06,
    network: "solana",
    description: "OpenAI chat completions",
    mimeType: "application/json",
  },
  "POST /openai/images/generations": {
    priceUsd: 0.15,
    network: "solana",
    description: "OpenAI image generations",
    mimeType: "application/json",
  },
  "GET /openai/models": {
    priceUsd: 0.02,
    network: "solana",
    description: "OpenAI models listing",
    mimeType: "application/json",
  },
  "POST /claude/messages": {
    priceUsd: 0.07,
    network: "solana",
    description: "Claude messages API",
    mimeType: "application/json",
  },
  "POST /google-sheets/values/get": {
    priceUsd: 0.04,
    network: "solana",
    description: "Google Sheets value retrieval",
    mimeType: "application/json",
  },
  "POST /google-sheets/values/update": {
    priceUsd: 0.05,
    network: "solana",
    description: "Google Sheets value update",
    mimeType: "application/json",
  },
  "POST /google-sheets/values/append": {
    priceUsd: 0.05,
    network: "solana",
    description: "Google Sheets append values",
    mimeType: "application/json",
  },

};
