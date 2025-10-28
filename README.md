# x402 Marketplace API Gateway

This service provides a payment-gated proxy to third-party APIs, starting with OpenAI. It is designed to run on Railway and verifies x402 protocol payments (to be implemented) before forwarding requests to upstream providers.

## Getting Started

1. Install dependencies:

```bash
npm install
```

2. Create an `.env` file:

```
OPENAI_API_KEY=sk-your-openai-key
X402_WALLET_ADDRESS=YOUR_SOLANA_WALLET_ADDRESS_HERE
PORT=3000
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

Each endpoint forwards the payload and headers to the OpenAI API using the configured `OPENAI_API_KEY`.

## Deploying to Railway

1. Push this repository to GitHub.
2. Create a new Railway project from the repository.
3. Add environment variables under **Variables**:
   - `OPENAI_API_KEY`
   - `X402_WALLET_ADDRESS`
   - `PORT` (optional, defaults to 3000)
4. Deploy. Railway will open the correct port automatically.

## TODO

- Add x402 payment verification middleware that checks on-chain proof before forwarding requests.
- Persist request/response metadata for billing and analytics.
- Expand routing to additional providers (Claude, Gemini, etc.).
