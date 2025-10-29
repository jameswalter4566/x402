declare module "x402/dist/cjs/types/index.js" {
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
  export const PaymentPayloadSchema: {
    parse(input: unknown): PaymentPayload;
  };
  export const PaymentRequirementsSchema: {
    parse(input: unknown): PaymentRequirements;
  };
  export const SupportedSVMNetworks: readonly string[];
  export function createSigner(
    network: string,
    privateKey: string,
  ): Promise<{ address?: string } & Record<string, unknown>>;
  export function isSvmSignerWallet(value: unknown): value is { address: string };
}

declare module "x402/dist/cjs/facilitator/index.js" {
  import type {
    PaymentPayload,
    PaymentRequirements,
    X402Config,
  } from "x402/dist/cjs/types/index.js";

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

declare module "x402/dist/cjs/client/index.js" {
  import type { PaymentRequirements } from "x402/dist/cjs/types/index.js";

  export function createPaymentHeader(
    client: unknown,
    version: number,
    requirements: PaymentRequirements,
    config?: unknown,
  ): Promise<string>;
}
