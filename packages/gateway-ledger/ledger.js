import { getSupabaseClient, isLedgerEnabled } from "./supabaseClient.js";

const TABLE_BALANCES = "credit_balances";
const TABLE_PAYMENTS = "payment_events";
const TABLE_USAGE = "usage_events";

const supabase = getSupabaseClient();
const ledgerActive = isLedgerEnabled();

export function ledgerEnabled() {
  return ledgerActive;
}

export async function fetchBalanceMicros(wallet) {
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

export async function hasSufficientCredits(wallet, amountMicros) {
  if (!supabase) {
    return { hasCredit: false, balanceMicros: 0 };
  }

  const balance = await fetchBalanceMicros(wallet);
  return {
    hasCredit: balance >= amountMicros,
    balanceMicros: balance,
  };
}

export async function recordPayment({
  wallet,
  amountMicros,
  resource,
  paymentPayload,
  verifyResponse,
  settleResponse,
}) {
  if (!supabase) {
    return;
  }

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

export async function consumeCredits({
  wallet,
  amountMicros,
  endpoint,
  description,
  billingMode,
  metadata,
}) {
  if (!supabase) {
    return;
  }

  const balance = await fetchBalanceMicros(wallet);
  if (balance < amountMicros) {
    throw new Error("insufficient_credits");
  }

  const newBalance = balance - amountMicros;
  const { error: updateError } = await supabase
    .from(TABLE_BALANCES)
    .upsert(
      {
        wallet,
        balance_micros: newBalance,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet" },
    );

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

async function incrementBalance(wallet, delta) {
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
