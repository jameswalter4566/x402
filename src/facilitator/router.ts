import express, { NextFunction, Request, Response, Router } from "express";
import { settle, verify } from "x402/facilitator";
import {
  PaymentPayload,
  PaymentPayloadSchema,
  PaymentRequirements,
  PaymentRequirementsSchema,
  SupportedPaymentKind,
  SupportedSVMNetworks,
  X402Config,
  createSigner,
  isSvmSignerWallet,
} from "x402/types";

type FacilitatorRouterOptions = {
  apiKey?: string;
  svmPrivateKey: string;
  svmRpcUrl?: string;
};

const X402_VERSION = 1;

export function createFacilitatorRouter(options: FacilitatorRouterOptions): Router {
  const { apiKey, svmPrivateKey, svmRpcUrl } = options;

  if (!svmPrivateKey) {
    throw new Error("SVM_PRIVATE_KEY is required to run the facilitator.");
  }

  const router = Router();
  router.use(express.json());

  const x402Config: X402Config | undefined = svmRpcUrl
    ? { svmConfig: { rpcUrl: svmRpcUrl } }
    : undefined;

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!apiKey) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${apiKey}`) {
      next();
      return;
    }

    res.status(401).json({ error: "unauthorized" });
  });

  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok", network: getNetworks() });
  });

  router.get("/supported", async (_req, res) => {
    try {
      const kinds: SupportedPaymentKind[] = [];
      for (const network of getNetworks()) {
        const signer = await createSigner(network, svmPrivateKey);
        const feePayer = isSvmSignerWallet(signer) ? signer.address : undefined;

        kinds.push({
          x402Version: X402_VERSION,
          scheme: "exact",
          network,
          extra: feePayer ? { feePayer } : undefined,
        });
      }

      res.json({ kinds });
    } catch (error) {
      console.error("Error building supported payment kinds", error);
      res.status(500).json({ error: "failed_to_list_supported" });
    }
  });

  router.post("/verify", async (req, res) => {
    try {
      const { paymentPayload, paymentRequirements } = parseBody(req.body);

      if (!isSupportedNetwork(paymentRequirements)) {
        res.status(400).json({ error: "unsupported_network" });
        return;
      }

      const signer = await createSigner(paymentRequirements.network, svmPrivateKey);
      const verification = await verify(signer, paymentPayload, paymentRequirements, x402Config);

      res.json(verification);
    } catch (error) {
      console.error("Facilitator verify error", error);
      res.status(400).json({ error: "invalid_request" });
    }
  });

  router.post("/settle", async (req, res) => {
    try {
      const { paymentPayload, paymentRequirements } = parseBody(req.body);

      if (!isSupportedNetwork(paymentRequirements)) {
        res.status(400).json({ error: "unsupported_network" });
        return;
      }

      const signer = await createSigner(paymentRequirements.network, svmPrivateKey);
      const response = await settle(signer, paymentPayload, paymentRequirements, x402Config);

      res.json(response);
    } catch (error) {
      console.error("Facilitator settle error", error);
      res.status(400).json({ error: "invalid_request" });
    }
  });

  router.get("/", (_req, res) => {
    res.json({
      message: "x402 Solana facilitator online",
      version: "1.0.0",
      health: "/facilitator/healthz",
      verify: "/facilitator/verify",
      settle: "/facilitator/settle",
      supported: "/facilitator/supported",
    });
  });

  function parseBody(body: unknown): {
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
  } {
    const requirements = PaymentRequirementsSchema.parse(
      (body as Record<string, unknown>)?.paymentRequirements,
    );
    const payload = PaymentPayloadSchema.parse((body as Record<string, unknown>)?.paymentPayload);
    return { paymentPayload: payload, paymentRequirements: requirements };
  }

  return router;
}

function getNetworks(): (typeof SupportedSVMNetworks)[number][] {
  return ["solana"];
}

function isSupportedNetwork(paymentRequirements: PaymentRequirements) {
  return getNetworks().includes(paymentRequirements.network as (typeof SupportedSVMNetworks)[number]);
}
