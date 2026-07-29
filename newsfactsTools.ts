/**
 * Shared NewsFacts agent tools (MCP + Gemini function calling).
 */
import { createBuyerClient } from './x402Client';

export const SEARCH_FACTS_TOOL = {
  type: 'function' as const,
  name: 'search_facts',
  description: 'Search NewsFacts by query. Returns summaries + citations (free endpoint).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default 5)' },
    },
    required: ['query'],
  },
};

export const GET_FACT_TOOL = {
  type: 'function' as const,
  name: 'get_fact',
  description:
    'Fetch full fact detail by ID (paid via Hedera x402 on testnet). Returns citation and HashScan payment link.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Fact ID from search_facts' },
    },
    required: ['id'],
  },
};

export const NEWSFACTS_GEMINI_TOOLS = [SEARCH_FACTS_TOOL, GET_FACT_TOOL];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createNewsFactsToolHandlers(serverUrl: string) {
  let payQueue: Promise<unknown> = Promise.resolve();
  const buyerPromise = createBuyerClient();

  async function payWithRetry(url: string, attempts = 3) {
    const buyer = await buyerPromise;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await buyer.pay(url);
      } catch (error) {
        lastError = error;
        await sleep(500 * attempt);
      }
    }
    throw lastError;
  }

  return {
    async search_facts(args: { query?: string; limit?: number }) {
      const query = String(args.query ?? '').trim();
      const limit = Number(args.limit ?? 5);
      if (!query) {
        throw new Error('query is required');
      }

      const url = `${serverUrl}/facts/search?q=${encodeURIComponent(query)}&limit=${Math.min(
        Math.max(limit, 1),
        20,
      )}`;
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(JSON.stringify(data));
      }
      return data;
    },

    async get_fact(args: { id?: string }) {
      const id = String(args.id ?? '').trim();
      if (!id) {
        throw new Error('id is required');
      }

      const url = `${serverUrl}/facts/detail/${id}`;
      const result = await (payQueue = payQueue.then(() => payWithRetry(url)));
      return {
        ...((result.data as object) ?? {}),
        payment: {
          transaction: result.transaction,
          payer: result.payer,
          hashscanUrl: result.hashscanUrl,
        },
      };
    },
  };
}

export type NewsFactsToolHandlers = ReturnType<typeof createNewsFactsToolHandlers>;
