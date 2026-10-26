import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
} from '../../src/tabletop/shared/tool-package.js';

/**
 * F080 / G1-01 + EDIT-01: the adapter that lets the existing DeepSeek account author a tool package.
 *
 * It only transports: prompt in, one JSON package definition plus usage out. Validation stays with the
 * authoring pipeline, so a model reply that is not a valid package is rejected there and never reaches
 * the isolated trial.
 */

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const TOOL_PACKAGE_MODEL = 'deepseek-flash';

export interface DeepSeekToolPackageUsage {
  calls: number;
  usd: number;
  promptTokens: number;
  completionTokens: number;
}

export interface DeepSeekToolPackageResult {
  definition: unknown;
  usage: DeepSeekToolPackageUsage;
  raw: string;
}

export class ToolPackageGenerationFailed extends Error {
  constructor(readonly code: 'EMPTY_REPLY' | 'NOT_JSON' | 'REQUEST_FAILED', message: string) {
    super(message);
    this.name = 'ToolPackageGenerationFailed';
  }
}

const SYSTEM_PROMPT = [
  'You author one Tabletop tool package as strict JSON. Reply with JSON only, no prose and no code fences.',
  `The JSON must satisfy: schemaVersion ${TOOL_PACKAGE_SCHEMA_VERSION}, runtimeProfile "${TOOL_PACKAGE_RUNTIME_PROFILE}", and packageId must match ^[a-z][a-z0-9-]{2,39}$.`,
  `Allowed UI imports are exactly ${Object.keys(TOOL_PACKAGE_PINNED_IMPORTS).join(', ')}; the imports object must pin each one.`,
  'Files are a list of {path, language, text}: at least one uiEntry file and at least one behaviorEntry file.',
  'Ports describe the joined data the UI may read; behaviours may only write to the resources their writes array declares, and may only propose actions listed in their actions array.',
  'Provenance is {origin: "ai", createdAt: <unix ms>}.',
].join(' ');

/**
 * Where the key comes from: the real environment first, then the ignored `.dev.vars` file that the local
 * Worker also reads. The value is never logged, and the file is gitignored so it cannot be committed.
 */
export function resolveDeepSeekKey(input: {
  env?: Record<string, string | undefined>;
  readDevVars?: (path: string) => string;
  devVarsPath?: string;
}): { key: string; source: 'environment' | 'dev.vars' | 'none' } {
  const fromEnv = input.env?.DEEPSEEK_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: 'environment' };

  const path = input.devVarsPath ?? '.dev.vars';
  if (input.readDevVars) {
    let text = '';
    try {
      text = input.readDevVars(path);
    } catch {
      return { key: '', source: 'none' };
    }
    for (const line of text.split(/\r?\n/u)) {
      const match = /^\s*DEEPSEEK_KEY\s*=\s*(.*)$/u.exec(line);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/gu, '');
      if (value) return { key: value, source: 'dev.vars' };
    }
  }
  return { key: '', source: 'none' };
}

/** Models like to wrap JSON in fences or add a sentence; take the outermost object and parse that. */
export function extractToolPackageJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) throw new ToolPackageGenerationFailed('EMPTY_REPLY', 'The model replied with nothing.');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new ToolPackageGenerationFailed('NOT_JSON', 'The reply did not contain a JSON object.');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new ToolPackageGenerationFailed('NOT_JSON', 'The reply looked like JSON but did not parse.');
  }
}

export interface DeepSeekToolPackageOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** USD per one million tokens, used only to report the cost of this run. */
  pricePerMillionUsd?: { prompt: number; completion: number };
}

export class DeepSeekToolPackageGenerator {
  readonly id = 'deepseek-tool-package';
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeepSeekToolPackageOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** The authoring pipeline asks for a ceiling before it spends anything. */
  estimate(): { calls: number; usd: number } {
    const price = this.options.pricePerMillionUsd ?? { prompt: 0.28, completion: 0.42 };
    const maxTokens = this.options.maxTokens ?? 4000;
    return {
      calls: 1,
      usd: Number(((maxTokens * price.completion + 2000 * price.prompt) / 1_000_000).toFixed(6)),
    };
  }

  async generate(input: { intent: string; base?: string; signal?: AbortSignal }): Promise<DeepSeekToolPackageResult> {
    if (!this.options.apiKey) throw new ToolPackageGenerationFailed('REQUEST_FAILED', 'No API key is configured for tool authoring.');

    const userContent = input.base
      ? `Intent: ${input.intent}\n\nCurrent package (the person edited this; keep everything they wrote and change only what the intent asks for):\n${input.base}`
      : `Intent: ${input.intent}`;

    let response: Response;
    try {
      response = await this.fetchImpl(DEEPSEEK_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model ?? TOOL_PACKAGE_MODEL,
          temperature: 0.2,
          max_tokens: this.options.maxTokens ?? 4000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
        }),
        signal: input.signal ?? AbortSignal.timeout(this.options.timeoutMs ?? 60_000),
      });
    } catch {
      throw new ToolPackageGenerationFailed('REQUEST_FAILED', 'The model request failed before a reply arrived.');
    }
    if (!response.ok) throw new ToolPackageGenerationFailed('REQUEST_FAILED', `The model request was refused (${response.status}).`);

    const payload = await response.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = payload.choices?.[0]?.message?.content ?? '';
    const definition = extractToolPackageJson(content);
    const promptTokens = payload.usage?.prompt_tokens ?? 0;
    const completionTokens = payload.usage?.completion_tokens ?? 0;
    const price = this.options.pricePerMillionUsd ?? { prompt: 0.28, completion: 0.42 };

    return {
      definition,
      raw: content,
      usage: {
        calls: 1,
        promptTokens,
        completionTokens,
        usd: Number(((promptTokens * price.prompt + completionTokens * price.completion) / 1_000_000).toFixed(6)),
      },
    };
  }
}
