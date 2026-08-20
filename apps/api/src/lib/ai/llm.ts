import { env } from '../../env';
import { logger } from '../logger';
import { TIMEOUTS } from '@gigachad/shared';

/**
 * Structured output schema the model must produce.
 * Validated before storage — a violation triggers one retry with a stricter
 * instruction, then `AI_INVALID_OUTPUT` (docs/08-ai.md).
 */
export interface SummaryOutput {
  userWants: string;
  tried: string;
  currentStatus: string;
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['userWants', 'tried', 'currentStatus'],
  properties: {
    userWants: { type: 'string', maxLength: 400 },
    tried: { type: 'string', maxLength: 600 },
    currentStatus: { type: 'string', maxLength: 400 },
  },
} as const;

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
export const PROMPT_VERSION = 'v1';

const SYSTEM_PROMPT = `You are a support ticket analyst. Return a JSON object with exactly three fields:
- "userWants": what the customer is trying to achieve (max 400 chars)
- "tried": what has been attempted so far, by either party (max 600 chars)
- "currentStatus": the current state or next required action (max 400 chars)

Rules:
- Plain text only. No markdown, no HTML.
- Never invent facts, promises, or resolutions not present in the messages.
- Distinguish customer claims from agent actions.
- Say "Not stated" when information is genuinely absent.
- Preserve concrete identifiers (order numbers, ticket IDs) when useful.`;

function validateOutput(raw: unknown): SummaryOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.userWants !== 'string' ||
    typeof o.tried !== 'string' ||
    typeof o.currentStatus !== 'string'
  ) {
    return null;
  }
  return {
    userWants: String(o.userWants).slice(0, 400),
    tried: String(o.tried).slice(0, 600),
    currentStatus: String(o.currentStatus).slice(0, 400),
  };
}

async function callOpenAI(
  messages: Array<{ role: string; content: string }>,
): Promise<unknown> {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TIMEOUTS.llmRequestMs,
  );

  let response: Response;
  try {
    response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 500,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.error({ status: response.status, openai: body }, 'openai request failed');
    throw new Error(`OpenAI error ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');
  return JSON.parse(content) as unknown;
}

/**
 * Calls the LLM with automatic retry on schema violation (docs/08-ai.md):
 * - Attempt 1: normal call
 * - Attempt 2 (schema failure only): stricter system message
 * - Returns null on final failure — caller stores AI_INVALID_OUTPUT
 */
export async function generateSummary(
  messageContext: string,
  previousSummary?: string,
): Promise<SummaryOutput | null> {
  const userContent = [
    previousSummary
      ? `Previous summary:\n${previousSummary}\n\n---\nConversation messages (newest first):`
      : 'Conversation messages (newest first):',
    messageContext,
  ].join('\n');

  const baseMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  for (let attempt = 0; attempt < TIMEOUTS.llmRetries; attempt++) {
    const messages =
      attempt === 0
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: 'assistant',
              content: '{"error":"invalid"}',
            },
            {
              role: 'user',
              content:
                'The previous response did not match the required JSON schema. ' +
                'Return ONLY a valid JSON object with exactly three string fields: ' +
                'userWants, tried, currentStatus. No other fields.',
            },
          ];

    try {
      const raw = await callOpenAI(messages);
      const validated = validateOutput(raw);
      if (validated) return validated;
      logger.warn({ attempt }, 'ai summary schema validation failed, retrying');
    } catch (err) {
      logger.warn({ err, attempt }, 'ai summary llm call failed');
      if (attempt === TIMEOUTS.llmRetries - 1) throw err;
    }
  }

  return null;
}
