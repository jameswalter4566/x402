import { getSupabaseClient, isLedgerEnabled } from "../lib/supabaseClient.js";

const TABLE_BALANCES = "credit_balances";
const TABLE_PAYMENTS = "payment_events";
const TABLE_USAGE = "usage_events";

const supabase = getSupabaseClient();
const ledgerActive = isLedgerEnabled();

export type PaymentRecordInput = {
  wallet: string;
  amountMicros: number;
  resource: string;
  paymentPayload: Record<string, unknown>;
  verifyResponse?: Record<string, unknown>;
  settleResponse?: Record<string, unknown>;
};

export type UsageRecordInput = {
  wallet: string;
  amountMicros: number;
  endpoint: string;
  description: string;
  billingMode: "credit" | "payment";
  metadata?: Record<string, unknown>;
};

export type CreditCheckResult = {
  hasCredit: boolean;
  balanceMicros: number;
};

export function ledgerEnabled(): boolean {
  return ledgerActive;
}

export async function fetchBalanceMicros(wallet: string): Promise<number> {
  if (!supabase) {
    return 0;
  }

  const { data, error } = await supabase
    .from(TABLE_BALANCES)
    .select("balance_micros")
    .eq("wallet", wallet)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Failed to fetch balance", error);
    throw error;
  }

  const balance = data?.balance_micros ?? 0;
  return typeof balance === "number" ? balance : Number(balance);
}

export async function hasSufficientCredits(
  wallet: string,
  amountMicros: number,
): Promise<CreditCheckResult> {
  if (!supabase) {
    return { hasCredit: false, balanceMicros: 0 };
  }

  const balance = await fetchBalanceMicros(wallet);
  return {
    hasCredit: balance >= amountMicros,
    balanceMicros: balance,
  };
}

export async function recordPayment(input: PaymentRecordInput): Promise<void> {
  if (!supabase) {
    return;
  }

  const { wallet, amountMicros, resource, paymentPayload, verifyResponse, settleResponse } = input;

  const { error: paymentError } = await supabase.from(TABLE_PAYMENTS).insert({
    wallet,
    amount_micros: amountMicros,
    resource,
    payment_payload: paymentPayload,
    verify_response: verifyResponse ?? null,
    settle_response: settleResponse ?? null,
  });

  if (paymentError) {
    console.error("Failed to record payment event", paymentError);
  }

  await incrementBalance(wallet, amountMicros);
}

export async function consumeCredits(input: UsageRecordInput): Promise<void> {
  if (!supabase) {
    return;
  }

  const { wallet, amountMicros, endpoint, metadata, billingMode, description } = input;

  const balance = await fetchBalanceMicros(wallet);
  if (balance < amountMicros) {
    throw new Error("insufficient_credits");
  }

  const newBalance = balance - amountMicros;
  const { error: updateError } = await supabase
    .from(TABLE_BALANCES)
    .upsert({
      wallet,
      balance_micros: newBalance,
      updated_at: new Date().toISOString(),
    }, { onConflict: "wallet" });

  if (updateError) {
    console.error("Failed to deduct credits", updateError);
    throw updateError;
  }

  const { error: usageError } = await supabase.from(TABLE_USAGE).insert({
    wallet,
    amount_micros: amountMicros,
    endpoint,
    billing_mode: billingMode,
    description,
    metadata: metadata ?? null,
  });

  if (usageError) {
    console.error("Failed to record usage event", usageError);
  }
}

async function incrementBalance(wallet: string, delta: number): Promise<void> {
  if (!supabase) {
    return;
  }

  const balance = await fetchBalanceMicros(wallet);
  const newBalance = balance + delta;

  const { error } = await supabase
    .from(TABLE_BALANCES)
    .upsert(
      {
        wallet,
        balance_micros: newBalance,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet" },
    );

  if (error) {
    console.error("Failed to increment balance", error);
  }
}
