/**
 * NewsFacts Buyer — Hedera x402 via @x402/hedera
 *
 * @see https://docs.hedera.com/solutions/ai/x402
 *
 * Usage:
 *   HEDERA_ACCOUNT_ID=0.0.x HEDERA_PRIVATE_KEY=0x... npm run client
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createBuyerClient } from './x402Client';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3002';
const QUERY = process.env.QUERY ?? 'drone';

async function main() {
  console.log('\n=== NewsFacts Hedera x402 Buyer ===\n');

  const buyer = await createBuyerClient();
  console.log(`Account: ${buyer.accountId}`);
  console.log(`Server:  ${SERVER_URL}`);

  console.log(`\n1. Searching facts for: "${QUERY}"...`);
  const searchUrl = `${SERVER_URL}/facts/search?q=${encodeURIComponent(QUERY)}&limit=1`;
  const searchResponse = await fetch(searchUrl);
  const searchData = await searchResponse.json();

  if (!searchResponse.ok || !searchData?.results?.length) {
    console.log('   No results found. Submit a fact first at /');
    return;
  }

  const factId = searchData.results[0].id as string;
  console.log(`   Found fact ID: ${factId}`);

  console.log(`\n2. Paying for /facts/detail/${factId} via Hedera x402...`);
  try {
    const result = await buyer.pay(`${SERVER_URL}/facts/detail/${factId}`);
    console.log('   Paid successfully');
    if (result.transaction) {
      console.log(`   Transaction: ${result.transaction}`);
    }
    if (result.hashscanUrl) {
      console.log(`   HashScan:    ${result.hashscanUrl}`);
    }
    console.log('   Response:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    console.log(`   Payment failed: ${(error as Error).message}`);
  }

  console.log('\n=== Done ===\n');
}

main().catch(console.error);
