import { NextFunction, Request, Response } from "express";

export type PaymentRouteConfig = {
  priceUsd: number;
  network: "solana";
  description: string;
  mimeType: string;
};

export type PaymentRoutesConfig = Record<string, PaymentRouteConfig>;

export type FacilitatorAuthConfig = {
  url: string;
  apiKey?: string;
};

export type PaymentContext = {
  paymentPayload: Record<string, unknown>;
  paymentRequirements: Record<string, unknown>;
  verifyResponse?: Record<string, unknown>;
  settleResponse?: Record<string, unknown>;
};

type RoutePattern = {
  method: string;
  path: string;
  config: PaymentRouteConfig;
};

const MICRO_USDC_MULTIPLIER = 1_000_000;

/**
 * Basic payment middleware that mirrors the x402 spec: it returns 402 until a valid X-PAYMENT
 * header is provided, verifies the payment with the configured facilitator, and settles once
 * the downstream handler succeeds.
 */
export function paymentMiddleware(
  payTo: string,
  routes: PaymentRoutesConfig,
  facilitator?: FacilitatorAuthConfig,
) {
  const patterns = compileRoutePatterns(routes);

  return async function handlePayment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (req.billing?.mode === "credit") {
      next();
      return;
    }

    const match = matchRoute(patterns, req.method, req.path);
    if (!match) {
      next();
      return;
    }

    const paymentRequirements = buildPaymentRequirements(req, match.config, payTo);
    const paymentHeader = req.header("X-PAYMENT");
    const x402Version = 1;

    if (!paymentHeader) {
      res.status(402).json({
        x402Version,
        error: "X-PAYMENT header is required",
        accepts: [paymentRequirements],
      });
      return;
    }

    let paymentPayload: Record<string, unknown>;
    try {
      const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
      paymentPayload = JSON.parse(decoded) as Record<string, unknown>;
    } catch (error) {
      console.error("Failed to decode X-PAYMENT header", error);
      res.status(402).json({
        x402Version,
        error: "Invalid X-PAYMENT header",
        accepts: [paymentRequirements],
      });
      return;
    }

    if (!facilitator?.url) {
      res.status(500).json({
        error: "facilitator_unavailable",
        message: "FACILITATOR_URL is not configured on the gateway",
      });
      return;
    }

    try {
      const verifyResponse = await callFacilitator(
        facilitator,
        "/verify",
        {
          x402Version,
          paymentPayload,
          paymentRequirements,
        },
      );

      if (!verifyResponse?.isValid) {
        res.status(402).json({
          x402Version,
          error: verifyResponse?.invalidReason ?? "payment_not_verified",
          accepts: [paymentRequirements],
          payer: verifyResponse?.payer,
        });
        return;
      }

      const payer = verifyResponse?.payer;
      if (typeof payer === "string" && req.senderWallet && payer !== req.senderWallet) {
        res.status(402).json({
          x402Version,
          error: "sender_wallet_mismatch",
          accepts: [paymentRequirements],
          payer,
        });
        return;
      }

      req.x402 = {
        paymentPayload,
        paymentRequirements,
        verifyResponse,
      };
    } catch (error) {
      console.error("Facilitator verification error", error);
      res.status(402).json({
        x402Version,
        error: "payment_verification_failed",
        details: error instanceof Error ? error.message : String(error),
        accepts: [paymentRequirements],
      });
      return;
    }

    const originalEnd = res.end.bind(res);
    let endArgs: unknown[] | null = null;

    res.end = ((...args: unknown[]) => {
      endArgs = args;
      return res;
    }) as typeof res.end;

    await next();

    if (res.statusCode >= 400) {
      res.end = originalEnd;
      if (endArgs) {
        originalEnd(...(endArgs as Parameters<typeof originalEnd>));
      }
      return;
    }

    try {
      const settleResponse = await callFacilitator(
        facilitator,
        "/settle",
        {
          x402Version,
          paymentPayload,
          paymentRequirements,
        },
      );

      if (!settleResponse?.success) {
        res.status(402).json({
          x402Version,
          error: settleResponse?.errorReason ?? "settlement_failed",
          accepts: [paymentRequirements],
        });
        return;
      }

      if (req.x402) {
        req.x402.settleResponse = settleResponse;
      }
    } catch (error) {
      console.error("Facilitator settlement error", error);
      if (!res.headersSent) {
        res.status(402).json({
          x402Version,
          error: "payment_settlement_failed",
          details: error instanceof Error ? error.message : String(error),
          accepts: [paymentRequirements],
        });
        return;
      }
    } finally {
      res.end = originalEnd;
      if (endArgs) {
        originalEnd(...(endArgs as Parameters<typeof originalEnd>));
      }
    }
  };
}

function compileRoutePatterns(routes: PaymentRoutesConfig): RoutePattern[] {
  return Object.entries(routes).map(([key, config]) => {
    const [method, ...pathParts] = key.trim().split(/\s+/);
    const path = pathParts.join(" ");
    return {
      method: method.toUpperCase(),
      path,
      config,
    };
  });
}

function matchRoute(
  patterns: RoutePattern[],
  method: string,
  requestPath: string,
): RoutePattern | undefined {
  return patterns.find(
    pattern => pattern.method === method.toUpperCase() && pattern.path === requestPath,
  );
}

function buildPaymentRequirements(
  req: Request,
  config: PaymentRouteConfig,
  payTo: string,
) {
  const micros = Math.round(config.priceUsd * MICRO_USDC_MULTIPLIER);
  return {
    scheme: "exact",
    network: config.network,
    maxAmountRequired: String(micros),
    resource: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
    description: config.description,
    mimeType: config.mimeType,
    payTo,
    maxTimeoutSeconds: 60,
    asset: "USDC",
    outputSchema: null,
    extra: {
      currency: "USDC",
      priceUsd: config.priceUsd,
    },
  };
}

async function callFacilitator(
  facilitator: FacilitatorAuthConfig,
  endpoint: "/verify" | "/settle",
  payload: Record<string, unknown>,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (facilitator.apiKey) {
    headers.Authorization = `Bearer ${facilitator.apiKey}`;
  }

  const url = `${facilitator.url}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Facilitator responded with ${response.status}: ${body}`);
  }

  return (await response.json()) as Record<string, unknown>;
}
