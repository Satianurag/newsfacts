/**
 * NewsFacts MCP Server
 *
 * Tools:
 * - search_facts (free)
 * - get_fact (paid via Hedera x402)
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });
import { createNewsFactsToolHandlers } from './newsfactsTools';

const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3002';

if (!process.env.HEDERA_ACCOUNT_ID && !process.env.HEDERA_CLIENT_ID) {
  console.error('Error: HEDERA_ACCOUNT_ID environment variable required for MCP.');
  console.error('Usage: HEDERA_ACCOUNT_ID=0.0.x HEDERA_PRIVATE_KEY=0x... npm run mcp');
  process.exit(1);
}

if (!process.env.HEDERA_PRIVATE_KEY && !process.env.HEDERA_CLIENT_KEY && !process.env.PRIVATE_KEY) {
  console.error('Error: HEDERA_PRIVATE_KEY environment variable required for MCP.');
  process.exit(1);
}

const MCP_BANNER = `NewsFacts MCP running (server: ${SERVER_URL}, network: Hedera x402)`;
process.stderr.write(`${MCP_BANNER}\n`);

async function main() {
  const handlers = createNewsFactsToolHandlers(SERVER_URL);
  const [
    { Server },
    { StdioServerTransport },
    { CallToolRequestSchema, ListToolsRequestSchema },
  ] = await Promise.all([
    import('@modelcontextprotocol/sdk/server'),
    import('@modelcontextprotocol/sdk/server/stdio'),
    import('@modelcontextprotocol/sdk/types'),
  ]);

  const server = new Server(
    {
      name: 'newsfacts-mcp',
      version: '0.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'search_facts',
        description:
          'Search NewsFacts by query. Returns summaries + citations (free endpoint).',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default 5)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_fact',
        description:
          'Fetch full fact detail by ID (paid via Hedera x402). Returns citation.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Fact ID from search_facts' },
          },
          required: ['id'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments ?? {};

    try {
      if (toolName === 'search_facts') {
        const data = await handlers.search_facts(args as { query?: string; limit?: number });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      }

      if (toolName === 'get_fact') {
        const data = await handlers.get_fact(args as { id?: string });
        return {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        };
      }

      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('MCP server failed to start', error);
  process.exit(1);
});
