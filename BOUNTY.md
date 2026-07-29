# Hedera x402 Bounty — NewsFacts Submission Guide

**Bounty:** [hedera.com/x402-bounty](https://hedera.com/x402-bounty)  
**Architecture:** Agent pays per query (Arch 1)  
**Deadline:** 31 July 2026

## What NewsFacts demonstrates

| Requirement | Implementation |
|---|---|
| x402 on Hedera testnet | `@x402/hedera` + Blocky402 facilitator |
| Agent / MCP access | `npm run mcp` — `search_facts` (free) + `get_fact` (paid) |
| Pay-per-fact | `GET /facts/detail/:id` returns **402**, buyer signs HBAR transfer |
| HashScan proof | Every payment prints a testnet transaction link |
| Storage | Neon Postgres + pgvector (semantic search) |
| Photos | Pinata IPFS (`PINATA_JWT`) |
| On-chain anchor | HCS topic message per fact (`HCS_TOPIC_ID`) |
| Browser wallet | HashPack via Reown (`REOWN_PROJECT_ID`) |

## Pre-demo checklist

```bash
cp .env.example .env
# Fill: DATABASE_URL, SELLER_ACCOUNT_ID, HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY
#       PINATA_JWT, REOWN_PROJECT_ID, HCS_TOPIC_ID

npm install
npm run server          # Terminal 1
npm run verify:full     # Terminal 2 — must PASS
npm run bounty:demo     # Terminal 2 — prints demo script output
```

## Demo video script (<5 min)

1. **Intro (30s)** — NewsFacts: eyewitness facts, agents pay per detail via x402 on Hedera.
2. **Submit (45s)** — Open `http://localhost:3002` → Submit tab → publish fact + optional photo.
3. **HCS proof (30s)** — Show HashScan link from publish response (on-chain anchor).
4. **Search (30s)** — Search & Pay tab → free semantic search.
5. **Wallet pay (60s)** — Connect HashPack → Pay → show full fact + HashScan payment tx.
6. **Agent/MCP (60s)** — `npm run client` or `npm run demo:run` → CLI pays, prints HashScan.
7. **Close (15s)** — Stack summary + GitHub repo URL.

## Verification commands

```bash
npm run verify:testnet   # x402 payment flow only
npm run verify:full      # facilitator + HCS + x402 end-to-end
npm run test:pinata      # IPFS upload smoke test
npm run demo:run         # 3 live payments with HashScan links
npm run demo:full        # Gemini agent + live payments (needs GEMINI_API_KEY)
```

## Deploy (Render)

1. Push to public GitHub.
2. Create Render Blueprint from `render.yaml`.
3. Set secrets: `DATABASE_URL`, `SELLER_ACCOUNT_ID`, `PINATA_JWT`, `REOWN_PROJECT_ID`, `HCS_TOPIC_ID`, `GEMINI_API_KEY`.
4. Health: `GET /health` → `{ "status": "ok", "photos": true, "hcs": true }`.

## Submission form

- **Repo URL:** public GitHub link
- **Demo video:** <5 min, shows search → 402 → pay → HashScan
- **Architecture:** Agent pays per query
- **Testnet proof:** include at least one HashScan transaction URL from `npm run bounty:demo`

## Example proof links (replace with your own)

- Payment: `https://hashscan.io/testnet/transaction/0.0.7162784@…`
- HCS anchor: `https://hashscan.io/testnet/transaction/0.0.9769419@…`
- HCS topic: `https://hashscan.io/testnet/topic/0.0.9827422`
- Seller: `https://hashscan.io/testnet/account/0.0.9733389`
- Buyer: `https://hashscan.io/testnet/account/0.0.9769419`

## Docs

- [Hedera x402](https://docs.hedera.com/solutions/ai/x402)
- [Blocky402 facilitator](https://api.testnet.blocky402.com/supported)
- [@x402/hedera](https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/hedera)
