declare module "x402/types" {
  export type PaymentPayload = Record<string, unknown>;
  export type PaymentRequirements = {
    network: string;
    [key: string]: unknown;
  };
  export type SupportedPaymentKind = {
    x402Version: number;
    scheme: string;
    network: string;
    extra?: Record<string, unknown>;
  };
  export type X402Config = {
    svmConfig?: {
      rpcUrl?: string;
    };
  };

  export const SupportedSVMNetworks: readonly string[];
  export const PaymentPayloadSchema: {
    parse(input: unknown): PaymentPayload;
  };
  export const PaymentRequirementsSchema: {
    parse(input: unknown): PaymentRequirements;
  };

  export function createSigner(
    network: string,
    secretKey: string,
  ): Promise<{ address?: string; [key: string]: unknown }>;
  export function isSvmSignerWallet(value: unknown): value is { address?: string };
}

declare module "x402/facilitator" {
  import type { PaymentPayload, PaymentRequirements, X402Config } from "x402/types";

  export type VerifyResponse = Record<string, unknown>;
  export type SettleResponse = Record<string, unknown>;

  export function verify(
    client: unknown,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    config?: X402Config,
  ): Promise<VerifyResponse>;

  export function settle(
    client: unknown,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    config?: X402Config,
  ): Promise<SettleResponse>;
}

declare module "x402/client" {
  import type { PaymentRequirements } from "x402/types";

  export function createPaymentHeader(
    client: unknown,
    version: number,
    requirements: PaymentRequirements,
    config?: unknown,
  ): Promise<string>;
}
