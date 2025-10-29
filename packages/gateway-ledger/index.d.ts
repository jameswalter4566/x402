import type { SupabaseClient } from "@supabase/supabase-js";

export interface PaymentRecordInput {
  wallet: string;
  amountMicros: number;
  resource: string;
  paymentPayload: Record<string, unknown>;
  verifyResponse?: Record<string, unknown>;
  settleResponse?: Record<string, unknown>;
}

export interface UsageRecordInput {
  wallet: string;
  amountMicros: number;
  endpoint: string;
  description: string;
  billingMode: "credit" | "payment";
  metadata?: Record<string, unknown>;
}

export interface CreditCheckResult {
  hasCredit: boolean;
  balanceMicros: number;
}

export function getSupabaseClient(): SupabaseClient | null;
export function isLedgerEnabled(): boolean;
export function ledgerEnabled(): boolean;
export function fetchBalanceMicros(wallet: string): Promise<number>;
export function hasSufficientCredits(wallet: string, amountMicros: number): Promise<CreditCheckResult>;
export function recordPayment(input: PaymentRecordInput): Promise<void>;
export function consumeCredits(input: UsageRecordInput): Promise<void>;
