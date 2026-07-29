import { Buffer } from 'buffer';
import type UniversalProvider from '@walletconnect/universal-provider';
import {
  HederaAdapter,
  HederaChainDefinition,
  HederaProvider,
  hederaNamespace,
} from '@hashgraph/hedera-wallet-connect';
import { createAppKit } from '@reown/appkit';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import {
  AccountId,
  Hbar,
  TokenId,
  TransactionId,
  TransferTransaction,
  assertSupportedHederaNetwork,
  createHederaClient,
  isHbarAsset,
} from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import type { PaymentRequirements } from '@x402/core/types';

declare global {
  interface Window {
    __NF_CONFIG__: {
      reownProjectId: string;
      network: 'hedera:testnet' | 'hedera:mainnet';
      price: string;
    };
  }
}

const config = window.__NF_CONFIG__;
let universalProvider: UniversalProvider | null = null;
let appKit: ReturnType<typeof createAppKit> | null = null;
let accountId: string | null = null;
let payFetch: typeof fetch | null = null;
let httpClient: x402HTTPClient | null = null;

function parseAccountId(address: string | undefined): string | null {
  if (!address) return null;
  const match = address.match(/0\.0\.\d+/);
  return match?.[0] ?? null;
}

function createWalletSigner(provider: UniversalProvider, payerAccountId: string) {
  const network = config.network;
  return {
    accountId: payerAccountId,
    createPartiallySignedTransferTransaction: async (requirements: PaymentRequirements) => {
      assertSupportedHederaNetwork(requirements.network);
      const feePayer = requirements.extra?.feePayer;
      if (typeof feePayer !== 'string') {
        throw new Error('feePayer is required in paymentRequirements.extra');
      }

      const amount = BigInt(requirements.amount);
      if (amount <= 0n) {
        throw new Error('amount must be greater than zero');
      }

      const parsedAccountId = AccountId.fromString(payerAccountId);
      const payTo = AccountId.fromString(requirements.payTo);
      const tx = new TransferTransaction();

      if (isHbarAsset(requirements.asset)) {
        tx.addHbarTransfer(parsedAccountId, Hbar.fromTinybars((-amount).toString()));
        tx.addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()));
      } else {
        const tokenId = TokenId.fromString(requirements.asset);
        tx.addTokenTransfer(tokenId, parsedAccountId, -amount);
        tx.addTokenTransfer(tokenId, payTo, amount);
      }

      tx.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)));
      const client = createHederaClient(network);
      try {
        tx.freezeWith(client);
        const signerAccountId = `${network}:${payerAccountId}`;
        const hederaProvider = provider as HederaProvider & {
          hedera_signTransaction: (args: {
            signerAccountId: string;
            transactionBody: TransferTransaction;
          }) => Promise<unknown>;
        };
        await hederaProvider.hedera_signTransaction({
          signerAccountId,
          transactionBody: tx,
        });
        return Buffer.from(tx.toBytes()).toString('base64');
      } finally {
        client.close();
      }
    },
  };
}

function setupPayClient() {
  if (!accountId || !universalProvider) return;
  const signer = createWalletSigner(universalProvider, accountId);
  const client = new x402Client().register('hedera:*', new ExactHederaScheme(signer));
  httpClient = new x402HTTPClient(client);
  payFetch = wrapFetchWithPayment(fetch, client);
}

export async function initWallet(onStatus: (message: string, isError?: boolean) => void) {
  if (!config.reownProjectId) {
    onStatus('Set REOWN_PROJECT_ID on the server to enable HashPack payments.', true);
    return;
  }

  const metadata = {
    name: 'NewsFacts',
    description: 'Pay-per-fact on Hedera x402',
    url: window.location.origin,
    icons: ['https://hashscan.io/favicon.ico'],
  };

  const hederaNativeAdapter = new HederaAdapter({
    projectId: config.reownProjectId,
    networks:
      config.network === 'hedera:mainnet'
        ? [HederaChainDefinition.Native.Mainnet]
        : [HederaChainDefinition.Native.Testnet],
    namespace: hederaNamespace,
  });

  universalProvider = (await HederaProvider.init({
    projectId: config.reownProjectId,
    metadata,
  })) as UniversalProvider;

  appKit = createAppKit({
    adapters: [hederaNativeAdapter],
    // @ts-expect-error universal provider type mismatch in wallet-connect
    universalProvider,
    projectId: config.reownProjectId,
    metadata,
    networks:
      config.network === 'hedera:mainnet'
        ? [HederaChainDefinition.Native.Mainnet]
        : [HederaChainDefinition.Native.Testnet],
  });

  appKit.subscribeAccount((account) => {
    accountId = parseAccountId(account?.address);
    if (accountId) {
      setupPayClient();
      onStatus(`Connected: ${accountId}`);
    } else {
      payFetch = null;
      httpClient = null;
      onStatus('Wallet disconnected.');
    }
  });

  onStatus('Click Connect HashPack to pay for fact details.');
}

export function connectWallet() {
  if (!appKit) {
    throw new Error('Wallet module not initialized');
  }
  appKit.open();
}

export function isWalletReady() {
  return Boolean(accountId && payFetch);
}

export async function payForFact(id: string): Promise<{
  factText: string;
  photos?: Array<{ cid: string; url: string; name: string; mimeType: string }>;
  hashscanUrl?: string;
}> {
  if (!payFetch || !httpClient || !accountId) {
    throw new Error('Connect HashPack first.');
  }

  const url = `/facts/detail/${id}`;
  const response = await payFetch(url);
  const raw = await response.text();
  let data: {
    fact?: { text?: string; photos?: Array<{ cid: string; url: string; name: string; mimeType: string }> };
    error?: string;
  } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error ?? raw ?? `HTTP ${response.status}`);
  }

  let hashscanUrl: string | undefined;
  try {
    const settlement = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
    if (settlement?.transaction) {
      const networkSlug = config.network === 'hedera:mainnet' ? 'mainnet' : 'testnet';
      hashscanUrl = `https://hashscan.io/${networkSlug}/transaction/${settlement.transaction}`;
    }
  } catch {
    // optional display field
  }

  return {
    factText: data.fact?.text ?? '',
    photos: data.fact?.photos,
    hashscanUrl,
  };
}
