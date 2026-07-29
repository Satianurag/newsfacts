# NewsFacts

Paid eyewitness facts with AI agent access via MCP and Gemini. Facts are stored in **Postgres + pgvector** (Neon). Payments settle on **Hedera testnet** using `@x402/hedera` and **Blocky402**.

## Stack

- Express 5 + TypeScript
- **Postgres + pgvector** (`pg` driver — Neon or local)
- `@x402/hedera`, `@x402/express`, `@x402/fetch`, `@x402/core`
- Blocky402 facilitator (`https://api.testnet.blocky402.com`)
- Local embeddings (`@xenova/transformers`)
- MCP server (stdio) + Gemini Interactions API (`gemini-3.1-flash-lite`)

## Prerequisites

- Node.js 20+
- **Neon** (or Postgres) database with `CREATE EXTENSION vector`
- Funded **ECDSA** Hedera testnet accounts (seller + buyer)
- Testnet HBAR: https://portal.hedera.com
- `GEMINI_API_KEY` for `demo:full` (Google AI Studio)

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL, SELLER_ACCOUNT_ID, HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY
npm install
```

In Neon SQL editor run once: `CREATE EXTENSION IF NOT EXISTS vector;`

## Run

```bash
# Terminal 1 — API + UI
npm run server

# Terminal 2 — buyer CLI (search + pay one fact)
npm run client

# MCP (stdio)
npm run mcp

# Full agent demo (Gemini + Hedera x402 payments)
npm run demo:full
```

Open http://localhost:3002 — use **Submit** to publish facts (optional IPFS photos via Pinata) and **Search & Pay** to query summaries and pay with HashPack.

## Deploy on Render

1. Push repo to GitHub and create a **Blueprint** from `render.yaml`.
2. Set secrets in the Render dashboard (`sync: false` in yaml):
   - `DATABASE_URL` (Neon with `CREATE EXTENSION vector`)
   - `SELLER_ACCOUNT_ID`, `GEMINI_API_KEY`
   - `REOWN_PROJECT_ID` (free at [dashboard.reown.com](https://dashboard.reown.com)) for browser wallet pay
3. Render sets `PORT` automatically; the app binds `HOST=0.0.0.0`.
4. Health check: `GET /health`

```bash
npm start   # runs postinstall browser build, then tsx server.ts
```

## Hedera x402 flow

1. Agent searches facts (free) — `GET /facts/search`
2. Agent requests fact detail — `GET /facts/detail/:id` returns **402**
3. Buyer signs native Hedera `TransferTransaction` via `@x402/hedera`
4. Blocky402 facilitator verifies, pays network fee, settles on testnet
5. Server returns fact + citation; buyer prints **HashScan** link

```
Agent → search_facts (free)
      → get_fact → 402 → sign HBAR transfer → Blocky402 → HashScan
```

## Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon/Postgres connection string (pgvector required) |
| `SELLER_ACCOUNT_ID` | Hedera account that receives payments (`0.0.x`) |
| `HEDERA_ACCOUNT_ID` | Buyer account for client/MCP/Gemini |
| `HEDERA_PRIVATE_KEY` | Buyer ECDSA private key |
| `FACILITATOR_URL` | Default `https://api.testnet.blocky402.com` |
| `FACT_PRICE_HBAR` | Price per fact in HBAR (default `0.1`) |
| `HEDERA_NETWORK` | `hedera:testnet` (default) |
| `GEMINI_API_KEY` | Google AI key for `demo:full` |
| `GEMINI_MODEL` | Default `gemini-3.1-flash-lite` |
| `GEMINI_THINKING_LEVEL` | Default `high` (multi-step tool use) |
| `REOWN_PROJECT_ID` | Reown/WalletConnect project id for HashPack in browser |
| `PINATA_JWT` | Pinata API JWT for eyewitness photo uploads to IPFS |
| `PINATA_GATEWAY` | Optional dedicated Pinata gateway domain |
| `HCS_TOPIC_ID` | Reuse an existing HCS topic for fact anchors |
| `HOST` | Bind address (default `0.0.0.0` for Render) |

See `.env.example` for full list.

## Verify + demos

```bash
npm run verify:testnet   # live Hedera testnet: create → 402 → pay → HashScan
npm run verify:full      # Blocky402 + HCS + x402 end-to-end
npm run bounty:demo      # bounty demo script for video recording
npm run test:pinata      # upload a 1x1 PNG to Pinata IPFS
npm run demo:run         # server running: create facts + 3 live payments
npm run demo:full        # server running: facts + Gemini agent + live payments
```

## Example HashScan links (testnet)

Replace with your own txs from `npm run client` or `demo:full`:

- https://hashscan.io/testnet/transaction/0.0.7162784@1785167055.685467029
- https://hashscan.io/testnet/account/0.0.9769419 (buyer)
- https://hashscan.io/testnet/account/0.0.9733389 (seller)

## Bounty submission

See **[BOUNTY.md](BOUNTY.md)** for the demo video script, checklist, and submission form notes.

```bash
npm run verify:full     # full stack: Blocky402 + HCS + x402
npm run bounty:demo     # step-by-step output for demo recording
```

## Bounty submission checklist

- [ ] Public GitHub repository
- [ ] `npm run verify:full` passes on testnet
- [ ] Demo video (&lt;5 min): search → pay → HashScan proof
- [ ] Built on x402 + Hedera testnet (Blocky402 facilitator)
- [ ] Submission form at https://hedera.com/x402-bounty/

## Docs

- [Hedera x402](https://docs.hedera.com/solutions/ai/x402)
- [@x402/hedera](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/hedera)
- [Blocky402 facilitator](https://api.testnet.blocky402.com/supported)
- [HashScan](https://hashscan.io/testnet)

## MCP config

For Gemini CLI or other MCP hosts, use `gemini.mcp.example.json` as a template — put real `HEDERA_ACCOUNT_ID` and `HEDERA_PRIVATE_KEY` in your environment, not in committed files.
