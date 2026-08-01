import { Buffer } from 'buffer';
import {
  DAppConnector,
  DAppSigner,
  extensionOpen,
  extensionQuery,
  findExtensions,
  HederaChainId,
  HederaJsonRpcMethod,
  HederaSessionEvent,
  type ExtensionData,
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

// Official HashPack Chrome extension ID (HIP-820 uses this as metadata.id)
const HASHPACK_CHROME_ID = 'gjagmgiddbbciopjhllkdnddhcglnemk';
const HASHPACK_INSTALL_URL = 'https://www.hashpack.app/';
const EXTENSION_POLL_MS = 400;
const EXTENSION_WAIT_MS = 6000;

const config = window.__NF_CONFIG__;
let dAppConnector: DAppConnector | null = null;
let dAppSigner: DAppSigner | null = null;
let accountId: string | null = null;
let payFetch: typeof fetch | null = null;
let httpClient: x402HTTPClient | null = null;
let statusCallback: ((message: string, isError?: boolean) => void) | null = null;
const discoveredExtensions: ExtensionData[] = [];
let legacyListenerInstalled = false;

function isHttpsOrigin() {
  return window.location.protocol === 'https:' || window.location.hostname === 'localhost';
}

function isHashpackExtension(ext: Pick<ExtensionData, 'id' | 'name'>) {
  const id = (ext.id ?? '').toLowerCase();
  const name = (ext.name ?? '').toLowerCase();
  return (
    id === 'hashpack' ||
    id === HASHPACK_CHROME_ID ||
    name.includes('hashpack')
  );
}

function rememberExtension(metadata: Partial<ExtensionData>, availableInIframe = false) {
  if (!metadata.id && !metadata.name) return;
  const ext: ExtensionData = {
    id: metadata.id ?? HASHPACK_CHROME_ID,
    name: metadata.name,
    icon: metadata.icon,
    url: metadata.url,
    available: true,
    availableInIframe,
  };
  if (!discoveredExtensions.some((item) => item.id === ext.id)) {
    discoveredExtensions.push(ext);
  }
}

function installLegacyHashpackListener() {
  if (legacyListenerInstalled || typeof window === 'undefined') return;
  legacyListenerInstalled = true;
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'hashconnect-query-extension-response' && event.data.metadata) {
      rememberExtension(event.data.metadata, false);
    }
  });
}

function registerExtensionDiscovery() {
  installLegacyHashpackListener();
  findExtensions((metadata, isIframe) => {
    rememberExtension(metadata, isIframe);
  });
}

function allExtensions(): ExtensionData[] {
  const merged = [...discoveredExtensions];
  for (const ext of dAppConnector?.extensions ?? []) {
    if (!merged.some((item) => item.id === ext.id)) {
      merged.push(ext);
    }
  }
  return merged;
}

function hashpackExtension() {
  return allExtensions().find((ext) => ext.available && isHashpackExtension(ext)) ?? null;
}

function syncConnectedAccount() {
  const signer = dAppConnector?.signers[0];
  if (!signer) {
    accountId = null;
    dAppSigner = null;
    payFetch = null;
    httpClient = null;
    statusCallback?.('HashPack disconnected.');
    return;
  }

  dAppSigner = signer;
  accountId = signer.getAccountId().toString();
  setupPayClient();
  statusCallback?.(`HashPack connected: ${accountId}`);
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

function probeExtensions() {
  extensionQuery();
  window.postMessage({ type: 'hashconnect-query-extension' }, '*');
}

async function waitForHashpackExtension() {
  const deadline = Date.now() + EXTENSION_WAIT_MS;
  while (Date.now() < deadline) {
    probeExtensions();
    const hashpack = hashpackExtension();
    if (hashpack) return hashpack;
    await new Promise((resolve) => setTimeout(resolve, EXTENSION_POLL_MS));
  }
  return hashpackExtension();
}

function hashpackMissingMessage() {
  return `HashPack extension not found on ${window.location.origin}. Install from ${HASHPACK_INSTALL_URL}, enable it in Chrome/Brave (chrome://extensions), unlock HashPack, select Testnet, then hard-refresh.`;
}

async function connectHashpack(hashpack: ExtensionData) {
  if (!dAppConnector) {
    throw new Error('HashPack module not initialized');
  }

  try {
    await dAppConnector.connectExtension(hashpack.id);
    return;
  } catch (hip820Error) {
    // Older HashPack builds use the legacy HashConnect extension message format.
    try {
      await dAppConnector.connect((uri) => {
        window.postMessage(
          { type: 'hashconnect-connect-extension', pairingString: uri },
          '*',
        );
        window.postMessage(
          { type: `hedera-extension-connect-${hashpack.id}`, pairingString: uri },
          '*',
        );
      });
      return;
    } catch (legacyError) {
      const hip = hip820Error instanceof Error ? hip820Error.message : String(hip820Error);
      const legacy = legacyError instanceof Error ? legacyError.message : String(legacyError);
      throw new Error(`HashPack connect failed (${hip}; ${legacy})`);
    }
  }
}

export async function initWallet(onStatus: (message: string, isError?: boolean) => void) {
  statusCallback = onStatus;
  registerExtensionDiscovery();

  if (!config.reownProjectId) {
    onStatus('Server missing REOWN_PROJECT_ID — HashPack payments are disabled.', true);
    return;
  }

  if (!isHttpsOrigin()) {
    onStatus('HashPack requires HTTPS. Open this site with https:// in the URL.', true);
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

  const hashpack = await waitForHashpackExtension();
  if (hashpack) {
    onStatus(`HashPack detected (${hashpack.name ?? hashpack.id}). Click Connect HashPack.`);
    return;
  }

  onStatus(hashpackMissingMessage(), true);
}

export async function connectWallet() {
  if (!dAppConnector) {
    throw new Error('HashPack module not initialized');
  }

  if (!isHttpsOrigin()) {
    throw new Error('HashPack requires HTTPS.');
  }

  let hashpack = hashpackExtension();
  if (!hashpack) {
    statusCallback?.('Looking for HashPack extension…');
    extensionOpen(HASHPACK_CHROME_ID);
    extensionOpen('hashpack');
    hashpack = await waitForHashpackExtension();
    if (!hashpack) {
      const message = hashpackMissingMessage();
      statusCallback?.(message, true);
      throw new Error(message);
    }
  }

  statusCallback?.('Opening HashPack — approve the connection in the extension popup.');

  try {
    await connectHashpack(hashpack);
    syncConnectedAccount();
    if (!accountId) {
      throw new Error('HashPack connected but no Hedera account was returned.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HashPack connection failed';
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
