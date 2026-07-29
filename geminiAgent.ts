/**
 * Gemini agent for NewsFacts using Interactions API + function calling.
 * @see https://ai.google.dev/gemini-api/docs/interactions
 * @see https://ai.google.dev/gemini-api/docs/gemini-3
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { GoogleGenAI } from '@google/genai';
import {
  NEWSFACTS_GEMINI_TOOLS,
  createNewsFactsToolHandlers,
  type NewsFactsToolHandlers,
} from './newsfactsTools';

export function getGeminiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    thinkingLevel: (process.env.GEMINI_THINKING_LEVEL || 'high') as
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high',
    maxToolRounds: Number(process.env.GEMINI_MAX_TOOL_ROUNDS ?? 12),
  };
}

/** @deprecated Use getGeminiConfig() */
export const geminiConfig = getGeminiConfig();

export type GeminiAgentStep = {
  type: 'function_call' | 'text';
  name?: string;
  arguments?: Record<string, unknown>;
  text?: string;
};

export type GeminiAgentResult = {
  outputText: string;
  steps: GeminiAgentStep[];
  interactionIds: string[];
};

type FunctionResultInput = {
  type: 'function_result';
  name: string;
  call_id: string;
  result: Array<{ type: 'text'; text: string }>;
};

export async function runGeminiNewsFactsAgent(options: {
  prompt: string;
  serverUrl: string;
  onStep?: (step: GeminiAgentStep) => void;
  handlers?: NewsFactsToolHandlers;
}): Promise<GeminiAgentResult> {
  const config = getGeminiConfig();
  if (!config.apiKey) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is required');
  }

  const ai = new GoogleGenAI({ apiKey: config.apiKey });
  const handlers = options.handlers ?? createNewsFactsToolHandlers(options.serverUrl);
  const toolMap: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    search_facts: (args) => handlers.search_facts(args as { query?: string; limit?: number }),
    get_fact: (args) => handlers.get_fact(args as { id?: string }),
  };

  const steps: GeminiAgentStep[] = [];
  const interactionIds: string[] = [];
  let input: string | FunctionResultInput[] = options.prompt;
  let previousInteractionId: string | null = null;

  for (let round = 0; round < config.maxToolRounds; round += 1) {
    const interaction = await ai.interactions.create({
      model: config.model,
      input,
      tools: NEWSFACTS_GEMINI_TOOLS,
      previous_interaction_id: previousInteractionId ?? undefined,
      generation_config: {
        thinking_level: config.thinkingLevel,
      },
    });

    interactionIds.push(interaction.id);

    const functionResults: FunctionResultInput[] = [];
    for (const step of interaction.steps ?? []) {
      if (step.type === 'function_call') {
        const callStep: GeminiAgentStep = {
          type: 'function_call',
          name: step.name,
          arguments: step.arguments as Record<string, unknown>,
        };
        steps.push(callStep);
        options.onStep?.(callStep);

        const handler = toolMap[step.name];
        if (!handler) {
          throw new Error(`Unknown tool: ${step.name}`);
        }

        const result = await handler((step.arguments ?? {}) as Record<string, unknown>);
        functionResults.push({
          type: 'function_result',
          name: step.name,
          call_id: step.id,
          result: [{ type: 'text', text: JSON.stringify(result) }],
        });
      } else if (step.type === 'text' && step.text) {
        const textStep: GeminiAgentStep = { type: 'text', text: step.text };
        steps.push(textStep);
        options.onStep?.(textStep);
      }
    }

    if (functionResults.length === 0) {
      return {
        outputText: interaction.output_text ?? '',
        steps,
        interactionIds,
      };
    }

    input = functionResults;
    previousInteractionId = interaction.id;
  }

  throw new Error(`Gemini agent exceeded max tool rounds (${config.maxToolRounds})`);
}
