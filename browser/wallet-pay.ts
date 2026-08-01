import { Buffer } from 'buffer';
import {
  DAppConnector,
  DAppSigner,
  HederaChainId,
  HederaJsonRpcMethod,
  HederaSessionEvent,
} from '@hashgraph/hedera-wallet-connect';
import { LedgerId } from '@hiero-ledger/sdk';
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
let dAppConnector: DAppConnector | null = null;
let dAppSigner: DAppSigner | null = null;
let accountId: string | null = null;
let payFetch: typeof fetch | null = null;
let httpClient: x402HTTPClient | null = null;
let statusCallback: ((message: string, isError?: boolean) => void) | null = null;

function parseAccountId(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/0\.0\.\d+/);
  return match?.[0] ?? null;
}

function getHashpackExtension() {
  return dAppConnector?.extensions.find((ext) => ext.id === 'hashpack' && ext.available) ?? null;
}

function syncConnectedAccount() {
  const signer = dAppConnector?.signers[0];
  if (!signer) {
    accountId = null;
    dAppSigner = null;
    payFetch = null;
    httpClient = null;
    statusCallback?.('Wallet disconnected.');
    return;
  }

  dAppSigner = signer;
  accountId = signer.getAccountId().toString();
  setupPayClient();
  statusCallback?.(`Connected: ${accountId}`);
}

function createWalletSigner(signer: DAppSigner, payerAccountId: string) {
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
        await signer.signTransaction(tx);
        return Buffer.from(tx.toBytes()).toString('base64');
      } finally {
        client.close();
      }
    },
  };
}

function setupPayClient() {
  if (!accountId || !dAppSigner) return;
  const signer = createWalletSigner(dAppSigner, accountId);
  const client = new x402Client().register('hedera:*', new ExactHederaScheme(signer));
  httpClient = new x402HTTPClient(client);
  payFetch = wrapFetchWithPayment(fetch, client);
}

export async function initWallet(onStatus: (message: string, isError?: boolean) => void) {
  statusCallback = onStatus;

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

  const ledgerId = config.network === 'hedera:mainnet' ? LedgerId.MAINNET : LedgerId.TESTNET;
  const chainId = config.network === 'hedera:mainnet' ? HederaChainId.Mainnet : HederaChainId.Testnet;

  dAppConnector = new DAppConnector(
    metadata,
    ledgerId,
    config.reownProjectId,
    Object.values(HederaJsonRpcMethod),
    [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
    [chainId],
    'error',
  );

  await dAppConnector.init({ logger: 'error' });

  // Extensions respond asynchronously to hedera-extension-query.
  await new Promise((resolve) => setTimeout(resolve, 800));

  const hashpack = getHashpackExtension();
  if (hashpack) {
    onStatus('HashPack extension detected. Click Connect HashPack.');
  } else if (window.location.protocol !== 'https:') {
    onStatus('Use HTTPS and install the HashPack browser extension, then refresh.', true);
  } else {
    onStatus(
      'HashPack extension not detected. Install it from hashpack.app, enable it, then refresh. You can also use WalletConnect QR in the modal.',
      true,
    );
  }
}

export async function connectWallet() {
  if (!dAppConnector) {
    throw new Error('Wallet module not initialized');
  }

  const hashpack = getHashpackExtension();
  statusCallback?.(
    hashpack
      ? 'Opening HashPack extension… approve the connection popup.'
      : 'Opening wallet modal… use WalletConnect QR if HashPack extension is not installed.',
  );

  try {
    if (hashpack) {
      await dAppConnector.connectExtension('hashpack');
    } else {
      await dAppConnector.openModal();
    }
    syncConnectedAccount();
    if (!accountId) {
      throw new Error('Wallet connected but no Hedera account was returned.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wallet connect failed';
    statusCallback?.(message, true);
    throw error;
  }
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
