/**
 * Live Hedera testnet verification: create fact → 402 → pay → HashScan proof.
 */
import '../loadEnv.js';
import { createBuyerClient } from '../x402Client.js';
import { initFactsStore } from '../factsStore.js';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3002';

async function main() {
  await initFactsStore();

  const health = await fetch(`${SERVER_URL}/health`);
  if (!health.ok) {
    throw new Error(`Server not reachable at ${SERVER_URL} (status ${health.status})`);
  }
  const healthData = (await health.json()) as { facts?: number; network?: string };
  console.log('Health:', healthData);

  const createRes = await fetch(`${SERVER_URL}/facts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `Testnet verify ${Date.now()} — drone spotted near Civic Center.`,
      author: 'Verify Script',
      location: 'San Francisco, CA',
    }),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create fact: ${await createRes.text()}`);
  }
  const { id } = (await createRes.json()) as { id: string };
  console.log('Created fact:', id);

  const unpaid = await fetch(`${SERVER_URL}/facts/detail/${id}`);
  if (unpaid.status !== 402) {
    throw new Error(`Expected 402, got ${unpaid.status}`);
  }
  console.log('Unpaid detail returned 402 as expected');

  const buyer = await createBuyerClient();
  const paid = await buyer.pay(`${SERVER_URL}/facts/detail/${id}`);
  if (!paid.transaction) {
    throw new Error('Payment succeeded but missing Hedera transaction id');
  }

  console.log('\nTestnet verification PASSED');
  console.log('Transaction:', paid.transaction);
  console.log('HashScan:', paid.hashscanUrl);
}

main().catch((error) => {
  console.error('\nTestnet verification FAILED:', error);
  process.exit(1);
});
