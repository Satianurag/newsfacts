/**
 * Hedera x402 buyer client.
 * @see https://docs.hedera.com/solutions/ai/x402
 * @see https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/hedera
 */
import './loadEnv.js';
import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { createClientHederaSigner, PrivateKey } from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { formatHashscanUrl } from './explorer';

export const buyerConfig = {
  HEDERA_ACCOUNT_ID:
    process.env.HEDERA_ACCOUNT_ID || process.env.HEDERA_CLIENT_ID || '',
  HEDERA_PRIVATE_KEY:
    process.env.HEDERA_PRIVATE_KEY ||
    process.env.HEDERA_CLIENT_KEY ||
    process.env.PRIVATE_KEY ||
    '',
  HEDERA_NETWORK: (process.env.HEDERA_NETWORK || 'hedera:testnet') as
    | 'hedera:testnet'
    | 'hedera:mainnet',
  HEDERA_KEY_TYPE: (process.env.HEDERA_KEY_TYPE || 'ecdsa').toLowerCase(),
};

function parseBuyerKey(raw: string) {
  if (buyerConfig.HEDERA_KEY_TYPE === 'ed25519') {
    return PrivateKey.fromStringED25519(raw);
  }
  const key = raw.startsWith('0x') ? raw : `0x${raw}`;
  return PrivateKey.fromStringECDSA(key);
}

export interface PaymentResult<T = unknown> {
  data: T;
  transaction?: string;
  payer?: string;
  hashscanUrl?: string;
}

/**
 * Create an x402 buyer using @x402/hedera + @x402/fetch.
 */
export async function createBuyerClient(
  privateKey?: string,
  accountId?: string,
) {
  const id = accountId || buyerConfig.HEDERA_ACCOUNT_ID;
  const key = privateKey || buyerConfig.HEDERA_PRIVATE_KEY;
  if (!id || !key) {
    throw new Error('HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set for x402 buyer');
  }

  const signer = createClientHederaSigner(id, parseBuyerKey(key), {
    network: buyerConfig.HEDERA_NETWORK,
  });

  const client = new x402Client().register('hedera:*', new ExactHederaScheme(signer));
  const httpClient = new x402HTTPClient(client);
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  return {
    accountId: id,
    pay: async (url: string): Promise<PaymentResult> => {
      const response = await fetchWithPayment(url);
      const raw = await response.text();
      let data: unknown = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = { raw };
      }

      if (!response.ok) {
        const paymentRequired = response.headers.get('payment-required');
        let detail = raw || `HTTP ${response.status}`;
        if (paymentRequired) {
          try {
            const decoded = JSON.parse(
              Buffer.from(paymentRequired, 'base64').toString('utf-8'),
            ) as { error?: string };
            if (decoded.error) detail = decoded.error;
          } catch {
            // keep raw detail
          }
        }
        throw new Error(`Hedera x402 payment failed: ${detail}`);
      }

      let settlement: ReturnType<x402HTTPClient['getPaymentSettleResponse']> | undefined;
      try {
        settlement = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
      } catch {
        settlement = undefined;
      }
      const tx = settlement?.transaction;
      if (!tx) {
        throw new Error('Hedera x402 payment missing settlement transaction id');
      }

      return {
        data,
        transaction: tx,
        payer: settlement?.payer,
        hashscanUrl: formatHashscanUrl(tx),
      };
    },
  };
}
