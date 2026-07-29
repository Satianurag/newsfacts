/**
 * Full-stack verification for bounty submission:
 * Blocky402 → create fact → HCS anchor → 402 → x402 pay → HashScan
 */
import '../loadEnv.js';
import { createBuyerClient } from '../x402Client.js';
import { initFactsStore } from '../factsStore.js';
import { isHcsConfigured } from '../hcsAnchor.js';
import { isPinataConfigured } from '../pinataStore.js';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3002';
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://api.testnet.blocky402.com';

type CreateFactResponse = {
  id: string;
  hcs?: { topicId: string; transactionId: string; hashscanUrl: string } | null;
  photos?: Array<{ cid: string; url: string }>;
};

async function checkFacilitator() {
  const response = await fetch(`${FACILITATOR_URL}/supported`);
  if (!response.ok) {
    throw new Error(`Facilitator /supported returned ${response.status}`);
  }
  const data = (await response.json()) as {
    supported?: string[];
    kinds?: Array<{ network?: string; extra?: { feePayer?: string } }>;
    signers?: Record<string, string[]>;
  };

  const networks =
    data.supported ??
    data.kinds?.map((kind) => kind.network).filter(Boolean) ??
    [];
  if (!networks.includes('hedera:testnet')) {
    throw new Error('Facilitator does not list hedera:testnet');
  }

  const feePayer =
    data.kinds?.find((kind) => kind.network === 'hedera:testnet')?.extra?.feePayer ??
    data.signers?.['hedera:*']?.[0];
  console.log('✓ Blocky402 facilitator:', feePayer ?? 'hedera:testnet');
}

async function main() {
  await initFactsStore();

  console.log('\n=== NewsFacts Full Verification ===\n');

  const healthRes = await fetch(`${SERVER_URL}/health`);
  if (!healthRes.ok) {
    throw new Error(`Server not reachable at ${SERVER_URL}`);
  }
  const health = (await healthRes.json()) as {
    facts?: number;
    photos?: boolean;
    hcs?: boolean;
    seller?: string;
    network?: string;
  };
  console.log('✓ Health:', {
    facts: health.facts,
    seller: health.seller,
    network: health.network,
    photos: health.photos ? 'Pinata' : 'off',
    hcs: health.hcs ? 'enabled' : 'off',
  });

  await checkFacilitator();

  const createRes = await fetch(`${SERVER_URL}/facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `Full verify ${Date.now()} — eyewitness report with HCS anchor.`,
      author: 'Verify Full',
      location: 'San Francisco, CA',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Create fact failed: ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as CreateFactResponse;
  console.log('✓ Created fact:', created.id);

  if (isHcsConfigured()) {
    if (!created.hcs?.transactionId) {
      throw new Error('HCS anchor missing on created fact');
    }
    console.log('✓ HCS anchor:', created.hcs.hashscanUrl);
    console.log('  Topic:', created.hcs.topicId);
  } else {
    console.log('· HCS skipped (operator not configured)');
  }

  if (isPinataConfigured()) {
    console.log('✓ Pinata configured (run npm run test:pinata for upload smoke test)');
  }

  const unpaid = await fetch(`${SERVER_URL}/facts/detail/${created.id}`);
  if (unpaid.status !== 402) {
    throw new Error(`Expected 402, got ${unpaid.status}`);
  }
  console.log('✓ Paid route returns 402 without payment');

  const buyer = await createBuyerClient();
  const paid = await buyer.pay(`${SERVER_URL}/facts/detail/${created.id}`);
  if (!paid.transaction) {
    throw new Error('x402 payment missing transaction id');
  }

  const detail = paid.data as {
    fact?: { photos?: Array<{ url: string }> };
    hcs?: { hashscanUrl?: string } | null;
  };

  console.log('✓ x402 payment settled');
  console.log('  Payment tx:', paid.transaction);
  console.log('  HashScan:', paid.hashscanUrl);
  if (detail.hcs?.hashscanUrl) {
    console.log('  HCS tx:  ', detail.hcs.hashscanUrl);
  }
  if (detail.fact?.photos?.length) {
    console.log('  Photos:  ', detail.fact.photos.map((p) => p.url).join(', '));
  }

  console.log('\nFull verification PASSED — ready for bounty demo.\n');
}

main().catch((error) => {
  console.error('\nFull verification FAILED:', error);
  process.exit(1);
});
