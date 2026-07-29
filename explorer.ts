const DEFAULT_NETWORK = process.env.HEDERA_NETWORK?.includes('mainnet') ? 'mainnet' : 'testnet';

export function formatHashscanUrl(transactionId: string, network = DEFAULT_NETWORK) {
  const base = process.env.HASHSCAN_BASE ?? `https://hashscan.io/${network}/transaction/`;
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return `${normalized}${transactionId}`;
}
