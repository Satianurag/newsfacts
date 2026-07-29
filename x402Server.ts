/**
 * Hedera x402 resource server setup (HBAR only).
 * @see https://docs.hedera.com/solutions/ai/x402
 * @see https://github.com/x402-foundation/x402/tree/main/typescript/packages/mechanisms/hedera
 */
import './loadEnv.js';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import type { Express } from 'express';

export const hederaConfig = {
  SELLER_ACCOUNT_ID: process.env.SELLER_ACCOUNT_ID || '',
  HEDERA_NETWORK: (process.env.HEDERA_NETWORK || 'hedera:testnet') as
    | 'hedera:testnet'
    | 'hedera:mainnet',
  FACILITATOR_URL:
    process.env.FACILITATOR_URL || process.env.X402_FACILITATOR_URL || 'https://api.testnet.blocky402.com',
  FACT_PRICE_HBAR: process.env.FACT_PRICE_HBAR || '0.1',
};

/** Native HBAR price for @x402/hedera exact scheme (amount in tinybars). */
export function hbarPrice(hbar: string) {
  const tinybars = BigInt(Math.round(parseFloat(hbar) * 1e8));
  return { amount: tinybars.toString(), asset: '0.0.0', extra: {} };
}

export function createHederaResourceServer() {
  const facilitatorClient = new HTTPFacilitatorClient({ url: hederaConfig.FACILITATOR_URL });
  return new x402ResourceServer(facilitatorClient).register(
    'hedera:*',
    new ExactHederaScheme(),
  );
}

type RouteMeta = {
  priceHbar: string;
  description: string;
  mimeType?: string;
};

function buildAccepts(meta: RouteMeta) {
  const payTo = hederaConfig.SELLER_ACCOUNT_ID;
  return {
    accepts: {
      scheme: 'exact' as const,
      network: hederaConfig.HEDERA_NETWORK,
      payTo,
      maxTimeoutSeconds: 180,
      price: hbarPrice(meta.priceHbar),
    },
    description: meta.description,
    mimeType: meta.mimeType || 'application/json',
  };
}

export function mountPaidRoutes(app: Express, routes: Record<string, RouteMeta>) {
  const payTo = hederaConfig.SELLER_ACCOUNT_ID;
  if (!payTo) {
    throw new Error('SELLER_ACCOUNT_ID must be set for Hedera x402 payments');
  }

  const routeConfig = Object.fromEntries(
    Object.entries(routes).map(([route, meta]) => [route, buildAccepts(meta)]),
  );

  app.use(paymentMiddleware(routeConfig, createHederaResourceServer()));
}
