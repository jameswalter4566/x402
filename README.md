# x402 Marketplace API Gateway

This service provides a payment-gated proxy to third-party APIs, starting with OpenAI. It is designed to run on Railway, verifies x402 protocol payments via a facilitator service, and tracks wallet balances in Supabase so callers can re-use credits until they run out.

## Getting Started

1. Install dependencies (requires the `stream-for-change-60505` repository to be checked out alongside this repo so the local `@stream-for-change/gateway-ledger` package can be resolved):

```bash
npm install
```

2. Create an `.env` file:

```
# Gateway configuration
PORT=3000
OPENAI_API_KEY=sk-your-openai-key
X402_GATEWAY_WALLET=YOUR_SOLANA_WALLET

# Facilitator (verification + settlement)
FACILITATOR_URL=https://your-facilitator-service
FACILITATOR_API_KEY=optional-bearer-token

# Supabase (credit ledger)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key
```

3. Run locally:

```bash
npm run dev
```

The gateway boots on `http://localhost:3000/` and returns onboarding instructions. Available endpoints include:

- `POST /openai/completions`
- `POST /openai/chat/completions`
- `POST /openai/images/generations`
- `GET /openai/models`

Each endpoint forwards the payload and headers to the OpenAI API using the configured `OPENAI_API_KEY`. Every request must include the `x402-sender-wallet` header (or `senderWallet` in the body) so the gateway can associate payments and credits with the correct wallet. When the wallet has insufficient balance, the gateway responds with HTTP 402 and a `PaymentRequirements` payload. The caller should:

1. Generate an `X-PAYMENT` header that satisfies the payment requirements.
2. Retry the same request with the `X-PAYMENT` header attached.

Once the facilitator verifies and settles the payment, the gateway stores the deposit in Supabase, deducts the metered cost for the request, and leaves the remainder available as credits for future calls.

If Supabase credentials are unavailable, the gateway still enforces the facilitator payment flow but skips credit persistence.

### Supabase schema

Provision the following tables (or equivalent views/procedures) inside your Supabase project:

```sql
create table public.credit_balances (
  wallet text primary key,
  balance_micros bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  amount_micros bigint not null,
  resource text not null,
  payment_payload jsonb not null,
  verify_response jsonb,
  settle_response jsonb,
  created_at timestamptz not null default now()
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  amount_micros bigint not null,
  endpoint text not null,
  billing_mode text not null,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index usage_events_wallet_idx on public.usage_events (wallet);
create index payment_events_wallet_idx on public.payment_events (wallet);
```

Restrict all direct access to these tables via Row Level Security or service-role API keys.

## Deploying to Railway

1. Push this repository to GitHub.
2. Create a new Railway project from the repository.
3. Add environment variables under **Variables**:
   - `OPENAI_API_KEY`
   - `X402_GATEWAY_WALLET`
   - `FACILITATOR_URL` (and `FACILITATOR_API_KEY` if your facilitator requires auth)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PORT` (optional, defaults to 3000)
4. Deploy. Railway will open the correct port automatically.

## TODO

- Add richer reconciliation for credit debits (move to SQL functions for atomicity).
- Surface wallet balances and payment history via an authenticated API.
- Expand routing to additional providers (Claude, Gemini, etc.).
