import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type { GenerateComponentRequest, GeneratedComponent, ModelRunResult } from './types.ts';
import { buildGenerationPrompt } from './prompt.ts';

export const MAX_GENERATION_MS = 180_000;
const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_TITLE_LENGTH = 90;
const MAX_EXPLANATION_LENGTH = 900;
const MAX_HTML_LENGTH = 16_000;
const MAX_CSS_LENGTH = 16_000;
const MAX_JS_LENGTH = 24_000;
const OUTPUT_SCHEMA_PATH = fileURLToPath(new URL('./schema.json', import.meta.url));

export type GenerationDiagnostic =
  | 'output.object_shape'
  | 'output.extra_key'
  | 'title.type'
  | 'title.empty'
  | 'title.too_long'
  | 'explanation.type'
  | 'explanation.empty'
  | 'explanation.too_long'
  | 'html.type'
  | 'html.empty'
  | 'html.too_long'
  | 'html.blocked_element'
  | 'html.inline_event_attribute'
  | 'html.url_attribute'
  | 'css.type'
  | 'css.too_long'
  | 'css.external_reference'
  | 'js.type_or_length'
  | 'js.script_tag'
  | 'js.modules'
  | 'js.network_or_worker_access'
  | 'js.browser_storage'
  | 'js.host_or_parent_access'
  | 'js.global_document_access'
  | 'js.dynamic_code_execution'
  | 'js.script_or_inline_event_injection'
  | 'settings.object_shape'
  | 'settings.extra_key'
  | 'settings.bpm'
  | 'settings.toleranceMs'
  | 'settings.splitHands'
  | 'settings.appearance'
  | 'api.expose_missing'
  | 'api.ready_missing'
  | 'api.onVisibility_missing'
  | 'api.onState_missing'
  | 'cli.stdout_limit'
  | 'cli.tool_event_blocked'
  | 'cli.event_json_invalid'
  | 'cli.final_message_missing'
  | 'cli.final_json_invalid'
  | 'cli.nonzero_exit';

const DISALLOWED_HTML = /<\s*\/?\s*(?:script|style|iframe|object|embed|form|meta|link|base)\b/i;
const INLINE_EVENT_ATTRIBUTE = /\s+on[a-z][\w:-]*\s*=/i;
const URL_ATTRIBUTE = /\s+(?:href|src|srcset|action|formaction|poster|xlink:href|style)\s*=/i;
const DISALLOWED_JS: ReadonlyArray<readonly [RegExp, GenerationDiagnostic]> = [
  [/\b(?:import|export)\b/, 'js.modules'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|importScripts|WebTransport|sendBeacon|postMessage)\b/, 'js.network_or_worker_access'],
  [/\b(?:localStorage|sessionStorage|indexedDB)\b|\bdocument\s*\.\s*cookie\b/i, 'js.browser_storage'],
  [/\b(?:window|parent|top|opener|globalThis|location|navigator)\b/, 'js.host_or_parent_access'],
  [/\bdocument\s*\./i, 'js.global_document_access'],
  [/\b(?:eval|Function)\s*(?:\(|\b)/, 'js.dynamic_code_execution'],
  [/\bdefaultView\b/, 'js.host_or_parent_access'],
  [/createElement\s*\(\s*['"]script['"]\s*\)|setAttribute\s*\(\s*['"]on/i, 'js.script_or_inline_event_injection'],
];

export class GenerationError extends Error {
  readonly code: 'unavailable' | 'cancelled' | 'timeout' | 'invalid-output' | 'failed';
  readonly diagnostic?: GenerationDiagnostic;

  constructor(code: 'unavailable' | 'cancelled' | 'timeout' | 'invalid-output' | 'failed', diagnostic?: GenerationDiagnostic) {
    super(code);
    this.name = 'GenerationError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseSettings(value: unknown): GeneratedComponent['settings'] {
  if (!isRecord(value)) throw new GenerationError('invalid-output', 'settings.object_shape');
  if (!hasOnlyKeys(value, ['bpm', 'toleranceMs', 'splitHands', 'appearance'])) throw new GenerationError('invalid-output', 'settings.extra_key');
  const { bpm, toleranceMs, splitHands, appearance } = value;
  if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < 30 || bpm > 240) throw new GenerationError('invalid-output', 'settings.bpm');
  if (typeof toleranceMs !== 'number' || !Number.isInteger(toleranceMs) || toleranceMs < 10 || toleranceMs > 1000) throw new GenerationError('invalid-output', 'settings.toleranceMs');
  if (typeof splitHands !== 'boolean') throw new GenerationError('invalid-output', 'settings.splitHands');
  if (typeof appearance !== 'string' || appearance.length < 1 || appearance.length > 200) throw new GenerationError('invalid-output', 'settings.appearance');
  return { bpm, toleranceMs, splitHands, appearance };
}

export function validateGeneratedComponent(value: unknown): GeneratedComponent {
  if (!isRecord(value)) throw new GenerationError('invalid-output', 'output.object_shape');
  if (!hasOnlyKeys(value, ['title', 'explanation', 'html', 'css', 'js', 'settings'])) throw new GenerationError('invalid-output', 'output.extra_key');
  const { title, explanation, html, css, js } = value;
  const settings = parseSettings(value.settings);
  if (typeof title !== 'string') throw new GenerationError('invalid-output', 'title.type');
  if (!title.trim()) throw new GenerationError('invalid-output', 'title.empty');
  if (title.length > MAX_TITLE_LENGTH) throw new GenerationError('invalid-output', 'title.too_long');
  if (typeof explanation !== 'string') throw new GenerationError('invalid-output', 'explanation.type');
  if (!explanation.trim()) throw new GenerationError('invalid-output', 'explanation.empty');
  if (explanation.length > MAX_EXPLANATION_LENGTH) throw new GenerationError('invalid-output', 'explanation.too_long');
  if (typeof html !== 'string') throw new GenerationError('invalid-output', 'html.type');
  if (!html.trim()) throw new GenerationError('invalid-output', 'html.empty');
  if (html.length > MAX_HTML_LENGTH) throw new GenerationError('invalid-output', 'html.too_long');
  if (typeof css !== 'string') throw new GenerationError('invalid-output', 'css.type');
  if (css.length > MAX_CSS_LENGTH) throw new GenerationError('invalid-output', 'css.too_long');
  if (typeof js !== 'string' || !js.trim() || js.length > MAX_JS_LENGTH) throw new GenerationError('invalid-output', 'js.type_or_length');
  if (DISALLOWED_HTML.test(html)) throw new GenerationError('invalid-output', 'html.blocked_element');
  if (INLINE_EVENT_ATTRIBUTE.test(html)) throw new GenerationError('invalid-output', 'html.inline_event_attribute');
  if (URL_ATTRIBUTE.test(html)) throw new GenerationError('invalid-output', 'html.url_attribute');
  if (/@import\b|url\s*\(/i.test(css)) throw new GenerationError('invalid-output', 'css.external_reference');
  if (/<\s*\/?\s*script\b/i.test(js)) throw new GenerationError('invalid-output', 'js.script_tag');
  const blockedJs = DISALLOWED_JS.find(([pattern]) => pattern.test(js));
  if (blockedJs) throw new GenerationError('invalid-output', blockedJs[1]);
  if (!/\bapi\s*\.\s*expose\s*\(/.test(js)) throw new GenerationError('invalid-output', 'api.expose_missing');
  if (!/\bapi\s*\.\s*ready\s*\(/.test(js)) throw new GenerationError('invalid-output', 'api.ready_missing');
  if (!/\bapi\s*\.\s*onVisibility\s*\(/.test(js)) throw new GenerationError('invalid-output', 'api.onVisibility_missing');
  if (!/\bapi\s*\.\s*onState\s*\(/.test(js)) throw new GenerationError('invalid-output', 'api.onState_missing');
  return { title, explanation, html, css, js, settings };
}

function modelIdentifier(event: unknown): string | undefined {
  if (!isRecord(event)) return undefined;
  const values: unknown[] = [event.model_id, event.modelId, event.model];
  if (isRecord(event.item)) values.push(event.item.model_id, event.item.modelId, event.item.model);
  const found = values.find((value): value is string => typeof value === 'string' && /^[a-zA-Z0-9_.:/ ()-]{1,100}$/.test(value));
  return found;
}

function messageFromEvent(event: unknown): string | undefined {
  if (!isRecord(event) || event.type !== 'item.completed' || !isRecord(event.item) || event.item.type !== 'agent_message') return undefined;
  return typeof event.item.text === 'string' ? event.item.text : undefined;
}

function terminateProcess(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const hardStop = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  }, 1_500);
  hardStop.unref();
}

export async function generateWithCodex(input: GenerateComponentRequest, signal: AbortSignal): Promise<ModelRunResult> {
  if (signal.aborted) throw new GenerationError('cancelled');
  const startedAt = performance.now();
  const args = [
    'exec',
    '--ephemeral',
    '--sandbox', 'read-only',
    '--ignore-user-config',
    '--disable', 'shell_tool',
    '--disable', 'multi_agent',
    '--disable', 'apps',
    '-c', 'web_search="disabled"',
    '--skip-git-repo-check',
    '--output-schema', OUTPUT_SCHEMA_PATH,
    '--json',
    '-C', tmpdir(),
    '-',
  ];
  const child = spawn('codex', args, { stdio: 'pipe', windowsHide: true, shell: false });
  let stdout = '';
  let stdoutBytes = 0;
  let finalMessage: string | undefined;
  let resolvedModelId: string | undefined;
  let streamError: GenerationError | undefined;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcess(child);
  }, MAX_GENERATION_MS);
  const onAbort = (): void => terminateProcess(child);
  signal.addEventListener('abort', onAbort, { once: true });

  const result = await new Promise<ModelRunResult>((resolve, reject) => {
    const parseEventLine = (line: string): void => {
      if (!line.trim() || streamError) return;
      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
        streamError = new GenerationError('failed', 'cli.event_json_invalid');
        terminateProcess(child);
        return;
      }
      const message = messageFromEvent(event);
      if (message) finalMessage = message;
      resolvedModelId = modelIdentifier(event) ?? resolvedModelId;
      if (isRecord(event) && event.type === 'item.completed' && isRecord(event.item)) {
        const itemType = event.item.type;
        if (typeof itemType === 'string' && /command|tool|mcp|web|file_change|patch/i.test(itemType)) {
          streamError = new GenerationError('failed', 'cli.tool_event_blocked');
          terminateProcess(child);
        }
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        streamError = new GenerationError('invalid-output', 'cli.stdout_limit');
        terminateProcess(child);
        return;
      }
      stdout += chunk.toString('utf8');
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) parseEventLine(line);
    });
    child.stderr.on('data', () => undefined);
    child.on('error', () => reject(new GenerationError('unavailable')));
    child.on('close', (code) => {
      clearTimeout(timer);
      parseEventLine(stdout);
      if (signal.aborted) {
        reject(new GenerationError('cancelled'));
        return;
      }
      if (timedOut) {
        reject(new GenerationError('timeout'));
        return;
      }
      if (streamError) {
        reject(streamError);
        return;
      }
      if (code !== 0) {
        reject(new GenerationError('failed', 'cli.nonzero_exit'));
        return;
      }
      if (!finalMessage) {
        reject(new GenerationError('failed', 'cli.final_message_missing'));
        return;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(finalMessage) as unknown;
      } catch {
        reject(new GenerationError('invalid-output', 'cli.final_json_invalid'));
        return;
      }
      try {
        const component = validateGeneratedComponent(decoded);
        resolve({ component, modelId: resolvedModelId ?? 'Codex configured default (not reported)', modelMs: Math.round(performance.now() - startedAt) });
      } catch (error) {
        reject(error instanceof GenerationError ? error : new GenerationError('invalid-output'));
      }
    });
    child.stdin.on('error', () => reject(new GenerationError('failed')));
    child.stdin.end(buildGenerationPrompt(input));
  });

  clearTimeout(timer);
  signal.removeEventListener('abort', onAbort);
  return result;
}
