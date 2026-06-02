import * as ai from 'ai';
import type { Client } from 'langsmith';

let client: Client | undefined;
let streamTextFn: typeof ai.streamText = ai.streamText;
let initialized = false;

export function isLangSmithEnabled(): boolean {
  const tracing =
    process.env.LANGSMITH_TRACING === 'true' ||
    process.env.LANGCHAIN_TRACING_V2 === 'true';
  const apiKey =
    process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY;
  return tracing && !!apiKey;
}

export function initLangSmithTracing(): boolean {
  if (initialized) {
    return !!client;
  }
  initialized = true;

  if (!isLangSmithEnabled()) {
    return false;
  }

  const apiKey =
    process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY;
  if (!apiKey) {
    return false;
  }

  if (!process.env.LANGCHAIN_API_KEY) {
    process.env.LANGCHAIN_API_KEY = apiKey;
  }
  if (!process.env.LANGCHAIN_TRACING_V2) {
    process.env.LANGCHAIN_TRACING_V2 = 'true';
  }
  if (process.env.LANGSMITH_PROJECT && !process.env.LANGCHAIN_PROJECT) {
    process.env.LANGCHAIN_PROJECT = process.env.LANGSMITH_PROJECT;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Client: LangSmithClient } = require('langsmith') as typeof import('langsmith');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { wrapAISDK } = require('langsmith/experimental/vercel') as typeof import('langsmith/experimental/vercel');

  client = new LangSmithClient();
  const wrapped = wrapAISDK(ai, { client });
  streamTextFn = wrapped.streamText;
  return true;
}

export function getStreamText() {
  return streamTextFn;
}

export function getLangSmithClient() {
  return client;
}

export async function flushLangSmithTraces(): Promise<void> {
  if (client) {
    await client.awaitPendingTraceBatches();
  }
}
