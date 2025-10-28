import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import openaiRouter from "./routes/openai.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  if (req.path === "/") return next();

  const senderWallet = (req.headers["x402-sender-wallet"] || req.body?.senderWallet) ?? "";
  if (typeof senderWallet !== "string" || senderWallet.trim().length === 0) {
    return res.status(400).json({
      error: "missing_sender_wallet",
      message: "Provide the wallet address you will use for payments via the `x402-sender-wallet` header or `senderWallet` field."
    });
  }

  req.senderWallet = senderWallet.trim();
  next();
});

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.X402_WALLET_ADDRESS || "9rKmtdWDHGmi3xqyvTM23Bps5wUwg2oB7Y9HAseRrxqv";

app.get("/", (req, res) => {
  res.json({
    message: "\uD83D\uDC4B Welcome to the x402 Marketplace API Gateway.",
    description: "Instant pay-per-use access to top APIs using the x402 protocol — starting with OpenAI.",
    status: "online",
    version: "1.0.0",
    payment_instructions: {
      how_to_pay: "Before using any endpoint, you must pay via x402 protocol to unlock access.",
      step_1: "Send your payment to the x402 Gateway wallet address:",
      wallet_address: WALLET_ADDRESS,
      step_2: "Include your request hash or session ID in the memo field for verification.",
      step_3: "Once payment is confirmed on-chain, retry your API call — the gateway will verify it automatically.",
      accepted_currencies: ["USDC", "SOL", "$402MARKET"],
      note: "Each call or session requires a valid on-chain payment. Unpaid requests will receive an HTTP 402 Payment Required response."
    },
    available_endpoints: {
      openai_completions: "/openai/completions",
      openai_chat_completions: "/openai/chat/completions",
      openai_images: "/openai/images/generations",
      openai_models: "/openai/models"
    },
    disclaimer: "x402 Marketplace acts as a payment-gated proxy layer for third-party APIs. Payments are verified on-chain and non-refundable."
  });
});

app.use("/openai", openaiRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not Found", path: req.path });
});

app.use((err, req, res, next) => {
  console.error("Unexpected error", err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`x402 OpenAI gateway running on port ${PORT}`);
});
