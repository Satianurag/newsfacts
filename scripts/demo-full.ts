/**
 * Full demo runner for live judging:
 * - Creates demo facts
 * - Shows search results
 * - Runs Gemini 3.1 Flash Lite agent (Interactions API + Hedera x402 tools)
 * - Prints final news output
 *
 * Set SKIP_GEMINI=1 to run setup + search only.
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'node:fs/promises';
import path from 'node:path';
import { getGeminiConfig, runGeminiNewsFactsAgent } from '../geminiAgent';
import { createBuyerClient } from '../x402Client';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3002';
const QUERY = process.env.QUERY ?? 'Give me news about drones in SF';
const SKIP_GEMINI = process.env.SKIP_GEMINI === '1';
const CREATOR_ACCOUNT_ID =
  process.env.DEFAULT_CREATOR_ACCOUNT_ID ?? process.env.CREATOR_ACCOUNT_ID ?? '';

const LOG_PATH = path.resolve('logs', 'demo-run.log');

const DEMO_FACTS = [
  {
    text: '6:42 PM — A red quadcopter touched down on the City Hall steps; two staffers collected a small metal case.',
    author: 'Elena Park',
    location: 'San Francisco, CA',
  },
  {
    text: '10:18 AM — A remote pilot guided a small aerial craft along the Embarcadero; it hovered briefly above Pier 7 before zipping north.',
    author: 'Maya Chen',
    location: 'Embarcadero, SF',
  },
  {
    text: '7:30 AM — Morning fog rolled through Twin Peaks; visibility dropped to a few blocks and drivers slowed noticeably.',
    author: 'Luis Ortega',
    location: 'Twin Peaks, SF',
  },
  {
    text: '1:05 PM — The Ferry Building farmers market opened with a new pop-up bakery line stretching past the fountain.',
    author: 'Nora Singh',
    location: 'Ferry Building, SF',
  },
];

function log(line: string) {
  process.stdout.write(`${line}\n`);
}

async function appendLog(line: string) {
  await fs.appendFile(LOG_PATH, `${line}\n`);
}

async function logBoth(line: string) {
  log(line);
  await appendLog(line);
}

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
  return res.json() as Promise<{
    id: string;
    summary: string;
    citation: string;
    createdAt: string;
  }>;
}

async function main() {
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
  await fs.writeFile(LOG_PATH, '');

  const buyer = await createBuyerClient();
  const seller = process.env.SELLER_ACCOUNT_ID ?? 'not set';

  await ensureServer();

  const resetRes = await fetch(`${SERVER_URL}/facts/reset`, { method: 'POST' });
  if (!resetRes.ok) {
    throw new Error('Reset endpoint failed. Start server with ALLOW_RESET=1.');
  }

  await logBoth('\n=== NewsFacts Demo (Full · Hedera x402 + Gemini) ===\n');
  await logBoth(`Buyer:  ${buyer.accountId}`);
  await logBoth(`Seller: ${seller}`);
  await logBoth(`Query: "${QUERY}"`);
  await logBoth(`Network: ${process.env.HEDERA_NETWORK ?? 'hedera:testnet'}`);
  const geminiConfig = getGeminiConfig();
  await logBoth(`Gemini: ${geminiConfig.model} (thinking: ${geminiConfig.thinkingLevel})`);

  await logBoth('\n1) Submitted facts:');
  for (const fact of DEMO_FACTS) {
    const created = await postFact(fact);
    await logBoth(
      `- ${created.id} | ${fact.author} | ${fact.location} | ${fact.text}`,
    );
  }

  await logBoth('\n2) Search results (top 2):');
  const searchRes = await fetch(
    `${SERVER_URL}/facts/search?q=${encodeURIComponent(QUERY)}&limit=2`,
  );
  const searchData = (await searchRes.json()) as {
    results: Array<{
      id: string;
      summary: string;
      score: number;
      author: string;
      location: string;
    }>;
  };
  for (const item of searchData.results) {
    await logBoth(
      `- ${item.id} | score ${item.score} | ${item.author} | ${item.location} | ${item.summary}`,
    );
  }

  if (SKIP_GEMINI) {
    await logBoth('\nSKIP_GEMINI=1 — skipping Gemini agent step.');
    await logBoth('\nDemo complete (setup only).');
    await logBoth(`Log saved to ${LOG_PATH}`);
    return;
  }

  const prompt = [
    'You are a NewsFacts buyer agent.',
    `Search for: "${QUERY}" (limit 2).`,
    'Call search_facts, then get_fact for the top 2 matching facts (real Hedera testnet x402 payments).',
    'Write a short personalized daily briefing with citations (author, timestamp, location, fact ID).',
    'Include each HashScan payment link from get_fact responses.',
  ].join(' ');

  await logBoth('\n3) Gemini agent prompt:');
  await logBoth(prompt);
  await logBoth('\n4) Gemini agent steps:');

  const result = await runGeminiNewsFactsAgent({
    prompt,
    serverUrl: SERVER_URL,
    onStep: async (step) => {
      if (step.type === 'function_call') {
        await logBoth(`→ ${step.name}(${JSON.stringify(step.arguments)})`);
      }
    },
  });

  await logBoth('\n5) Gemini briefing:\n');
  await logBoth(result.outputText);
  await logBoth(`\nInteractions: ${result.interactionIds.join(', ')}`);
  await logBoth('\nDemo complete.');
  await logBoth(`Log saved to ${LOG_PATH}`);
}

main().catch((error) => {
  console.error('\nDemo failed:', error);
  process.exit(1);
});
