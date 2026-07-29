/**
 * Demo runner: creates facts, pays for 3 facts, and prints HashScan links.
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createBuyerClient } from '../x402Client';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3002';
const CREATOR_ACCOUNT_ID =
  process.env.DEFAULT_CREATOR_ACCOUNT_ID ?? process.env.CREATOR_ACCOUNT_ID ?? '';

const DEMO_FACTS = [
  {
    text: '6:42 PM — I saw a red drone land on the City Hall steps; two staffers collected a small metal case.',
    author: 'Elena Park',
    location: 'San Francisco, CA',
  },
  {
    text: '2:15 PM — A power flicker hit the Mission St. subway entrance; kiosk screens rebooted and gates stayed open for about 90 seconds.',
    author: 'Samir Khan',
    location: 'Mission St Station, SF',
  },
  {
    text: '9:05 AM — A blue cargo bike delivered three sealed crates to the newsroom loading bay; the driver wore a bright yellow jacket.',
    author: 'Riley Moore',
    location: 'SoMa, SF',
  },
  {
    text: '11:30 AM — A protest march paused at Market & 5th; organizers handed out flyers titled “Open Data Now”.',
    author: 'Jordan Lee',
    location: 'Market & 5th, SF',
  },
];

async function ensureServer() {
  const res = await fetch(`${SERVER_URL}/health`);
  if (!res.ok) throw new Error('Server not healthy');
}

async function postFact(payload: {
  text: string;
  author: string;
  location: string;
}) {
  const res = await fetch(`${SERVER_URL}/facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, creatorAddress: CREATOR_ACCOUNT_ID }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create fact: ${body}`);
  }
  return res.json() as Promise<{ id: string }>;
}

async function main() {
  console.log('\n=== NewsFacts Hedera Demo Runner ===\n');
  await ensureServer();

  const buyer = await createBuyerClient();
  const seller = process.env.SELLER_ACCOUNT_ID ?? 'not set';

  console.log('Buyer:', buyer.accountId);
  console.log('Seller:', seller);
  console.log('Creator:', CREATOR_ACCOUNT_ID || 'not set');

  console.log('\n1) Creating demo facts...');
  const factIds: string[] = [];
  for (const fact of DEMO_FACTS) {
    const created = await postFact(fact);
    factIds.push(created.id);
  }
  console.log('   Created', factIds.length, 'facts');

  console.log('\n2) Paying for top 3 facts...');
  const payIds = factIds.slice(0, 3);
  for (const id of payIds) {
    const url = `${SERVER_URL}/facts/detail/${id}`;
    const result = await buyer.pay(url);
    console.log(`   Paid ${id} -> ${result.transaction ?? 'n/a'}`);
    if (result.hashscanUrl) {
      console.log(`   HashScan: ${result.hashscanUrl}`);
    }
  }

  console.log('\n3) HashScan account links');
  console.log(`   Buyer:   https://hashscan.io/testnet/account/${buyer.accountId}`);
  if (CREATOR_ACCOUNT_ID) {
    console.log(`   Creator: https://hashscan.io/testnet/account/${CREATOR_ACCOUNT_ID}`);
  }
  if (seller !== 'not set') {
    console.log(`   Seller:  https://hashscan.io/testnet/account/${seller}`);
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Demo run failed:', error);
  process.exit(1);
});
