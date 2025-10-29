import { Router, Request, Response } from "express";
import { createPaymentHeader } from "x402/client";
import {
  PaymentRequirements,
  PaymentRequirementsSchema,
  X402Config,
  createSigner,
} from "x402/types";

type AdminRouterOptions = {
  testPayerPrivateKey?: string;
  testPayerWallet?: string;
  gatewayBaseUrl: string;
  x402Config?: X402Config;
};

type AdminTestResult = {
  paymentRequirements: PaymentRequirements;
  gatewayResponseStatus: number;
  gatewayResponseBody: unknown;
};

const X402_VERSION = 1;

export function createAdminRouter(options: AdminRouterOptions): Router {
  const router = Router();
  const { testPayerPrivateKey, testPayerWallet, gatewayBaseUrl, x402Config } = options;
  const walletAddress = testPayerWallet?.trim();

  router.post("/test-openai", async (req: Request, res: Response) => {
    try {
      if (!testPayerPrivateKey || !walletAddress) {
        res.status(500).json({ error: "missing_test_payer_configuration" });
        return;
      }

      const requirements = await fetchPaymentRequirements(gatewayBaseUrl, walletAddress);
      const testResult = await performGatewayTest(
        gatewayBaseUrl,
        walletAddress,
        testPayerPrivateKey,
        requirements,
        x402Config,
      );

      res.json({
        message: "Gateway test executed",
        paymentRequirements: testResult.paymentRequirements,
        gatewayStatus: testResult.gatewayResponseStatus,
        gatewayResponse: testResult.gatewayResponseBody,
      });
    } catch (error) {
      console.error("Admin gateway test failed", error);
      res.status(500).json({
        error: "gateway_test_failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

async function fetchPaymentRequirements(
  baseUrl: string,
  wallet: string,
): Promise<PaymentRequirements> {
  const response = await fetch(`${baseUrl}/openai/models`, {
    method: "GET",
    headers: {
      "x402-sender-wallet": wallet,
      "content-type": "application/json",
      accept: "application/json",
    },
  });

  const body = await response.json();

  if (response.status !== 402) {
    throw new Error(
      `Expected 402 Payment Required but received ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  const accepts = (body as Record<string, unknown>)?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error("Payment requirements were not returned by the gateway");
  }

  return PaymentRequirementsSchema.parse(accepts[0]) as PaymentRequirements;
}

async function performGatewayTest(
  baseUrl: string,
  wallet: string,
  payerPrivateKey: string,
  requirements: PaymentRequirements,
  config?: X402Config,
): Promise<AdminTestResult> {
  const signer = await createSigner(requirements.network, payerPrivateKey);
  const paymentHeader = await createPaymentHeader(signer, X402_VERSION, requirements, config);

  const response = await fetch(`${baseUrl}/openai/models`, {
    method: "GET",
    headers: {
      "x402-sender-wallet": wallet,
      "X-PAYMENT": paymentHeader,
      accept: "application/json",
    },
  });

  let responseBody: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    responseBody = await response.json();
  } else {
    responseBody = await response.text();
  }

  return {
    paymentRequirements: requirements,
    gatewayResponseStatus: response.status,
    gatewayResponseBody: responseBody,
  };
}
