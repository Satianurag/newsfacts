/**
 * Bounty demo script — prints step-by-step output for a <5 min demo video.
 * Run with server up: npm run bounty:demo
 */
import '../loadEnv.js';
import { createBuyerClient } from '../x402Client.js';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3002';
const QUERY = process.env.DEMO_QUERY ?? 'drone';

const STEP = (n: number, title: string) => {
  console.log(`\n━━━ Step ${n}: ${title} ━━━`);
};

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  NewsFacts — Hedera x402 Bounty Demo             ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`\nServer: ${SERVER_URL}`);
  console.log('Architecture: Agent pays per query (Hedera bounty Arch 1)\n');

  STEP(1, 'Health check');
  const health = await fetch(`${SERVER_URL}/health`).then((r) => r.json());
  console.log(JSON.stringify(health, null, 2));

  STEP(2, 'Submit eyewitness fact (free)');
  const createRes = await fetch(`${SERVER_URL}/facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `Demo ${Date.now()} — Red drone hovered over Civic Center plaza for 90 seconds.`,
      author: 'Demo Witness',
      location: 'Civic Center, SF',
    }),
  });
  const created = await createRes.json();
  console.log('Fact ID:', created.id);
  if (created.hcs?.hashscanUrl) {
    console.log('HCS anchor (immutable proof):', created.hcs.hashscanUrl);
  }
  if (created.photos?.length) {
    console.log('IPFS photos:', created.photos.map((p: { url: string }) => p.url).join(', '));
  }

  STEP(3, 'Free semantic search');
  const searchUrl = `${SERVER_URL}/facts/search?q=${encodeURIComponent(QUERY)}&limit=3`;
  console.log('GET', searchUrl);
  const search = await fetch(searchUrl).then((r) => r.json());
  console.log(`Found ${search.count} result(s) for "${QUERY}"`);
  for (const item of search.results ?? []) {
    console.log(`  · [${item.score}] ${item.summary.slice(0, 80)}…`);
  }

  const targetId = created.id ?? search.results?.[0]?.id;
  if (!targetId) {
    throw new Error('No fact id to pay for');
  }

  STEP(4, 'Request paid detail → HTTP 402');
  const unpaid = await fetch(`${SERVER_URL}/facts/detail/${targetId}`);
  console.log('Status:', unpaid.status, '(Payment Required)');
  const paymentRequired = unpaid.headers.get('payment-required');
  console.log('payment-required header:', paymentRequired ? 'present' : 'missing');

  STEP(5, 'Agent pays via Hedera x402 (@x402/hedera + Blocky402)');
  const buyer = await createBuyerClient();
  console.log('Buyer account:', buyer.accountId);
  const paid = await buyer.pay(`${SERVER_URL}/facts/detail/${targetId}`);
  console.log('\n✓ Payment settled on Hedera testnet');
  console.log('  Transaction:', paid.transaction);
  console.log('  HashScan:   ', paid.hashscanUrl);

  const detail = paid.data as {
    fact?: { text?: string; photos?: Array<{ url: string }> };
    hcs?: { topicId?: string; hashscanUrl?: string } | null;
    citation?: string;
  };
  if (detail.fact?.text) {
    console.log('\nFull fact text:', detail.fact.text);
  }
  if (detail.citation) {
    console.log('Citation:', detail.citation);
  }
  if (detail.hcs?.hashscanUrl) {
    console.log('On-chain anchor:', detail.hcs.hashscanUrl);
  }

  STEP(6, 'Bounty proof links');
  console.log('Seller:      ', process.env.SELLER_ACCOUNT_ID);
  console.log('Buyer:       ', buyer.accountId);
  console.log('Facilitator: ', process.env.FACILITATOR_URL ?? 'https://api.testnet.blocky402.com');
  console.log('HCS topic:   ', process.env.HCS_TOPIC_ID ?? detail.hcs?.topicId ?? 'n/a');
  console.log('\nDemo complete. Record browser UI at', SERVER_URL);
  console.log('Submit: https://hedera.com/x402-bounty/\n');
}

main().catch((error) => {
  console.error('Bounty demo failed:', error);
  process.exit(1);
});
