/**
 * Hedera Consensus Service anchoring for published facts.
 */
import './loadEnv.js';
import { createHash } from 'crypto';
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hashgraph/sdk';

export type HcsAnchor = {
  topicId: string;
  transactionId: string;
  hashscanUrl: string;
  message: string;
};

function parseOperatorKey(raw: string) {
  const keyType = (process.env.HEDERA_KEY_TYPE || 'ecdsa').toLowerCase();
  if (keyType === 'ed25519') {
    return PrivateKey.fromStringED25519(raw);
  }
  return PrivateKey.fromStringECDSA(raw.startsWith('0x') ? raw : `0x${raw}`);
}

export function isHcsConfigured() {
  const accountId =
    process.env.HCS_OPERATOR_ACCOUNT_ID?.trim() ||
    process.env.HEDERA_ACCOUNT_ID?.trim() ||
    process.env.SELLER_ACCOUNT_ID?.trim();
  const privateKey =
    process.env.HCS_OPERATOR_PRIVATE_KEY?.trim() ||
    process.env.HEDERA_PRIVATE_KEY?.trim();
  return Boolean(accountId && privateKey);
}

function getOperatorCredentials() {
  const accountId =
    process.env.HCS_OPERATOR_ACCOUNT_ID?.trim() ||
    process.env.HEDERA_ACCOUNT_ID?.trim() ||
    process.env.SELLER_ACCOUNT_ID?.trim();
  const privateKey =
    process.env.HCS_OPERATOR_PRIVATE_KEY?.trim() ||
    process.env.HEDERA_PRIVATE_KEY?.trim();

  if (!accountId || !privateKey) {
    throw new Error('HCS operator credentials are not configured');
  }

  return { accountId, privateKey };
}

function getClient() {
  const network = process.env.HEDERA_NETWORK || 'hedera:testnet';
  const client = network.includes('mainnet') ? Client.forMainnet() : Client.forTestnet();
  const { accountId, privateKey } = getOperatorCredentials();
  client.setOperator(accountId, parseOperatorKey(privateKey));
  return client;
}

function hashscanNetwork() {
  return (process.env.HEDERA_NETWORK || 'hedera:testnet').includes('mainnet')
    ? 'mainnet'
    : 'testnet';
}

export async function ensureTopicId() {
  const configured = process.env.HCS_TOPIC_ID?.trim();
  if (configured) return configured;

  const client = getClient();
  try {
    const response = await new TopicCreateTransaction()
      .setTopicMemo('NewsFacts eyewitness fact anchors')
      .execute(client);
    const receipt = await response.getReceipt(client);
    const topicId = receipt.topicId?.toString();
    if (!topicId) {
      throw new Error('Topic creation did not return a topic id');
    }
    console.warn(`Created HCS topic ${topicId}. Set HCS_TOPIC_ID=${topicId} in .env to reuse it.`);
    return topicId;
  } finally {
    client.close();
  }
}

export async function anchorFactOnHcs(input: {
  factId: string;
  text: string;
  author: string;
  location: string;
  createdAt: string;
  photoCids?: string[];
}): Promise<HcsAnchor> {
  const topicId = await ensureTopicId();
  const messageObject = {
    v: 1,
    app: 'newsfacts',
    factId: input.factId,
    textHash: createHash('sha256').update(input.text).digest('hex'),
    author: input.author,
    location: input.location,
    createdAt: input.createdAt,
    photos: input.photoCids ?? [],
  };

  let message = JSON.stringify(messageObject);
  if (message.length > 1024) {
    message = JSON.stringify({
      ...messageObject,
      author: undefined,
      location: undefined,
      photos: (input.photoCids ?? []).slice(0, 3),
    });
  }
  if (message.length > 1024) {
    message = JSON.stringify({
      v: 1,
      app: 'newsfacts',
      factId: input.factId,
      textHash: messageObject.textHash,
      createdAt: input.createdAt,
    });
  }

  const client = getClient();
  try {
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(message)
      .execute(client);
    const receipt = await response.getReceipt(client);
    if (receipt.status.toString() !== 'SUCCESS') {
      throw new Error(`HCS anchor failed with status ${receipt.status.toString()}`);
    }

    const transactionId = response.transactionId.toString();
    return {
      topicId,
      transactionId,
      hashscanUrl: `https://hashscan.io/${hashscanNetwork()}/transaction/${transactionId}`,
      message,
    };
  } finally {
    client.close();
  }
}
