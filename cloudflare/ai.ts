import { z } from 'zod';
import { invoiceChangeSchema, encounterRuleSchema, physicsParamsSchema } from '../src/tabletop/domain/index.js';
import { aiTableChangeIssues, tableChangeIssues, tableChangeSchema, tableProgramSchema, tableRecordsSchema, TABLE_AI_INPUT_BYTES, TABLE_FILE_BYTES, TABLE_TOTAL_SOURCE_BYTES } from '../src/tabletop/domain/table.js';
import { DATE_SCHEMA, ID_SCHEMA, MAX_SATANG } from '../src/tabletop/domain/helpers.js';
import { DomainError, type ChangeSet, type WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { DeepSeekProvider, type DeepSeekUsage } from '../server/providers/deepseek.js';
import type { ModelInput } from '../server/model.js';
import { DeepSeekChangeProvider, ModelProviderClosed, ModelRequestTimeout, ModelStreamFailure, RejectedChangeReply, measureDeepSeekChangeRequest, MAX_CHANGE_REQUEST_BYTES, TABLE_REQUEST_TOKEN_MARGIN, type DeepSeekChangeInput, type DeepSeekChangeProgress, type TableClarification } from '../server/providers/deepseek-changes.js';
import { runResearch } from '../server/providers/deepseek-research.js';
import type { ModelJobSearchProgress } from '../src/tabletop/shared/model-job-progress.js';
import { priceMicroUsd, type BillingRequestBinding, type BillingUsage } from './billing.js';
import type { Env } from './contracts.js';
import { aiTableDeadlineMs } from './ai-deadline.js';
import { ReasonedDomainError } from './model-failure.js';
import { EDIT_FALLBACK_SIMPLIFY_ISSUES, FALLBACK_REPAIR_ATTEMPT, FALLBACK_SIMPLIFY_ISSUES, nextRepairIssues } from './repair.js';

const MAX_PROMPT_CHARS = 4_000;
const MAX_INVOICE_INPUT_BYTES = 48_000;
const MAX_CHANGE_INPUT_BYTES = 24_000;
const MAX_TABLE_INPUT_BYTES = TABLE_AI_INPUT_BYTES;
const PROVIDER_OVERHEAD_BYTES = 8_000;
const MAX_STANDARD_PROVIDER_INPUT_TOKENS = 56_000;
// A request is measured in bytes and one byte is at most one token, so the reservation covers the largest request.
const MAX_PROVIDER_INPUT_TOKENS = MAX_CHANGE_REQUEST_BYTES + TABLE_REQUEST_TOKEN_MARGIN;
const INVOICE_MAX_OUTPUT_TOKENS = 2_048;
const CHANGE_MAX_OUTPUT_TOKENS = 512;
const TABLE_MAX_OUTPUT_TOKENS = 32_768;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkspaceView(value: unknown): value is WorkspaceView {
  if (!isRecord(value) || !isRecord(value.actor) || !isRecord(value.domain) || !Array.isArray(value.members)) return false;
  if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.revision !== 'string'
    || !Number.isSafeInteger(value.epoch) || typeof value.createdAt !== 'number' || typeof value.expiresAt !== 'number') return false;
  if (!['invoice', 'teaching', 'encounter', 'table'].includes(String(value.kind))) return false;
  if (!['invoice', 'teaching', 'encounter', 'table'].includes(String(value.domain.kind))) return false;
  if (value.domain.kind !== value.kind) return false;
  if (typeof value.actor.actorId !== 'string' || typeof value.actor.name !== 'string'
    || !['owner', 'teacher', 'learner', 'dm', 'player', 'participant'].includes(String(value.actor.role))) return false;
  return value.members.every((member) => isRecord(member)
    && typeof member.actorId === 'string' && typeof member.name === 'string'
    && ['owner', 'teacher', 'learner', 'dm', 'player', 'participant'].includes(String(member.role)));
}

const requestSchema = z.strictObject({
  workspace: z.custom<WorkspaceView>(isWorkspaceView),
  actorId: ID_SCHEMA,
  commandId: ID_SCHEMA,
  prompt: z.string().min(3).max(MAX_PROMPT_CHARS),
  consent: z.literal(true),
  sourceId: z.string().min(1).max(160).optional(),
});

const teachingChangeSchema: z.ZodType<ChangeSet> = z.strictObject({
  kind: z.literal('teaching'),
  parameters: physicsParamsSchema,
});
const encounterChangeSchema: z.ZodType<ChangeSet> = z.strictObject({
  kind: z.literal('encounter'),
  rule: encounterRuleSchema,
});
const invoiceDomainSchema = z.object({
  kind: z.literal('invoice'),
  sources: z.array(z.object({
    id: ID_SCHEMA,
    kind: z.enum(['shipments', 'invoice', 'rate-card', 'excerpt']),
    status: z.enum(['provided', 'verified', 'rejected']),
    excerpt: z.string().max(100_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).max(100),
  rules: z.array(z.object({
    id: ID_SCHEMA,
    kind: z.enum(['base', 'step', 'surcharge']),
    zone: z.union([z.enum(['bangkok', 'regional']), z.literal('*')]),
    amountSatang: z.number().int().safe().min(0).max(MAX_SATANG),
    from: DATE_SCHEMA,
    to: DATE_SCHEMA.nullable(),
    sourceId: ID_SCHEMA,
    enabled: z.boolean(),
  })).max(200),
});
const teachingDomainSchema = z.object({ kind: z.literal('teaching'), parameters: physicsParamsSchema });
const encounterDomainSchema = z.object({ kind: z.literal('encounter'), rule: encounterRuleSchema });
const tableDomainSchema = z.object({
  kind: z.literal('table'),
  sources: z.array(z.object({
    id: z.string().min(1).max(100),
    filename: z.string().min(1).max(120),
    text: z.string().min(1).max(TABLE_FILE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).max(4),
  program: tableProgramSchema.nullable(),
  records: tableRecordsSchema,
  turn: z.string().max(40).nullable(),
  // F037: notes travel with the table state so the draft can use them as knowledge.
  notes: z.array(z.object({ text: z.string().max(500), color: z.string().max(20) })).max(20).optional(),
});
const billingUsageSchema = z.strictObject({
  promptTokens: z.number().int().safe().nonnegative(),
  completionTokens: z.number().int().safe().nonnegative(),
  cacheHitTokens: z.number().int().safe().nonnegative(),
  cacheMissTokens: z.number().int().safe().nonnegative(),
  reasoningTokens: z.number().int().safe().nonnegative().optional(),
});
const billingSuccessSchema = z.strictObject({
  ok: z.literal(true),
  status: z.enum(['reserved', 'dispatching', 'settled', 'uncertain']).optional(),
  claimed: z.boolean().optional(),
  duplicate: z.boolean().optional(),
  reservedMicroUsd: z.number().int().safe().nonnegative().optional(),
  actualMicroUsd: z.number().int().safe().nonnegative().optional(),
  usage: billingUsageSchema.optional(),
});

export interface AIProposalRequest {
  workspace: WorkspaceView;
  actorId: string;
  commandId: string;
  prompt: string;
  consent: true;
  sourceId?: string;
}

/** Table requests may return a question for the owner instead of a draft (F012). */
export type AIProposalResult =
  | { change: ChangeSet; jobId: string; usage: DeepSeekUsage }
  | { clarification: TableClarification; jobId: string; usage: DeepSeekUsage };

type BillingBinding = BillingRequestBinding;
export type AIBillingBinding = BillingBinding;

type PreparedInput =
  | { kind: 'invoice'; providerInput: ModelInput; hashInput: unknown; maxOutputTokens: number; maximumInputBytes: number }
  | { kind: 'teaching' | 'encounter' | 'table'; providerInput: DeepSeekChangeInput; hashInput: unknown; maxOutputTokens: number; maximumInputBytes: number };

interface BillingResponse {
  ok: boolean;
  errorCode?: string;
  status?: 'reserved' | 'dispatching' | 'settled' | 'uncertain';
  claimed?: boolean;
  duplicate?: boolean;
  reservedMicroUsd?: number;
  actualMicroUsd?: number;
  usage?: BillingUsage;
}

class AIError extends DomainError {
  constructor(code: string, message: string) { super(code, message); }
}

function fail(code: string, message: string): never {
  throw new AIError(code, message);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** F036: no money cap. Only the provider key is required; usage is still metered per job. */
function billingConfigured(env: Env): void {
  if (!env.DEEPSEEK_KEY || env.DEEPSEEK_KEY.length > 4096 || /\s/.test(env.DEEPSEEK_KEY)) {
    fail('MODEL_NOT_CONFIGURED', 'AI proposals are not configured for this workspace.');
  }
}

function actorAndRole(request: AIProposalRequest): void {
  const { workspace, actorId } = request;
  const actor = workspace.actor;
  const member = workspace.members.find((item) => item.actorId === actorId);
  if (actor.actorId !== actorId || !member || member.role !== actor.role) {
    fail('AI_FORBIDDEN', 'The current room membership cannot request this proposal.');
  }
  // F035: the Room checks the rules.draft permission before dispatching; here only the caller's membership.
  if (workspace.domain.kind !== workspace.kind || !Number.isSafeInteger(workspace.epoch)
    || workspace.epoch < 0 || typeof workspace.revision !== 'string' || workspace.revision.length > 256) {
    fail('AI_CONTEXT_INVALID', 'The current room state is invalid.');
  }
}

function prepareInput(request: AIProposalRequest): PreparedInput {
  const { workspace, prompt } = request;
  if (workspace.domain.kind === 'invoice') {
    const state = invoiceDomainSchema.safeParse(workspace.domain);
    if (!state.success) fail('AI_CONTEXT_INVALID', 'The current invoice state is invalid.');
    const invoice = state.data;
    const source = invoice.sources.find((item) => item.id === request.sourceId
      && item.status === 'verified' && (item.kind === 'rate-card' || item.kind === 'excerpt'));
    if (!source) fail('SOURCE_REQUIRED', 'Select a verified rate card or excerpt before requesting an invoice proposal.');
    const providerInput = {
      prompt,
      sourceId: source.id,
      excerpt: source.excerpt.slice(0, 4_000),
      rules: structuredClone(invoice.rules),
    };
    return {
      kind: 'invoice',
      providerInput,
      hashInput: { kind: 'invoice', prompt, source: { id: source.id, sha256: source.sha256, excerpt: providerInput.excerpt }, rules: providerInput.rules },
      maxOutputTokens: INVOICE_MAX_OUTPUT_TOKENS,
      maximumInputBytes: MAX_INVOICE_INPUT_BYTES,
    };
  }
  if (request.sourceId !== undefined) fail('AI_INPUT_INVALID', 'This proposal type does not accept a source identifier.');
  if (workspace.domain.kind === 'teaching') {
    const parsed = teachingDomainSchema.safeParse(workspace.domain);
    if (!parsed.success) fail('AI_CONTEXT_INVALID', 'The current teaching state is invalid.');
    const providerInput: DeepSeekChangeInput = { kind: 'teaching', prompt, parameters: structuredClone(parsed.data.parameters) };
    return {
      kind: 'teaching',
      providerInput,
      hashInput: providerInput,
      maxOutputTokens: CHANGE_MAX_OUTPUT_TOKENS,
      maximumInputBytes: MAX_CHANGE_INPUT_BYTES,
    };
  }
  if (workspace.domain.kind === 'table') {
    const parsed = tableDomainSchema.safeParse(workspace.domain);
    if (!parsed.success) fail('AI_CONTEXT_INVALID', 'The current table state is invalid.');
    const sourceBytes = parsed.data.sources.reduce((total, source) => total + new TextEncoder().encode(source.text).byteLength, 0);
    if (sourceBytes > TABLE_TOTAL_SOURCE_BYTES) fail('MODEL_PROVIDER_INPUT_TOO_LARGE', 'The table sources exceed the allowed proposal size.');
    // Files the active rules already cite were imported earlier: their rows are in records and their quotes are
    // checked against the stored text, so only their names travel. A large table can keep growing this way.
    const cited = new Set((parsed.data.program?.evidence ?? []).map((item) => item.sourceId));
    const imported = parsed.data.sources.filter((source) => cited.has(source.id));
    const providerInput: DeepSeekChangeInput = {
      kind: 'table',
      prompt,
      sources: parsed.data.sources.filter((source) => !cited.has(source.id)).map(({ id, filename, text }) => ({ id, filename, text })),
      ...(imported.length ? { importedSources: imported.map(({ id, filename }) => ({ id, filename, note: IMPORTED_SOURCE_NOTE })) } : {}),
      program: structuredClone(parsed.data.program),
      records: structuredClone(parsed.data.records),
      turn: parsed.data.turn,
      ...(parsed.data.notes?.length ? { notes: parsed.data.notes.map(({ text, color }) => ({ text, color })) } : {}),
    };
    return {
      kind: 'table',
      providerInput,
      hashInput: providerInput,
      maxOutputTokens: TABLE_MAX_OUTPUT_TOKENS,
      maximumInputBytes: MAX_TABLE_INPUT_BYTES,
    };
  }
  const parsed = encounterDomainSchema.safeParse(workspace.domain);
  if (!parsed.success) fail('AI_CONTEXT_INVALID', 'The current encounter state is invalid.');
  const providerInput: DeepSeekChangeInput = { kind: 'encounter', prompt, rule: structuredClone(parsed.data.rule) };
  return {
    kind: 'encounter',
    providerInput,
    hashInput: providerInput,
    maxOutputTokens: CHANGE_MAX_OUTPUT_TOKENS,
    maximumInputBytes: MAX_CHANGE_INPUT_BYTES,
  };
}

/** Read by the model next to each omitted file, so the system prompt stays within its size budget. */
const IMPORTED_SOURCE_NOTE = 'Already cited by the current program; text omitted to keep the request small, rows are in records. Keep evidence that cites it exactly as is; never write a new quote from it.';

function mapUsage(usage: DeepSeekUsage): BillingUsage {
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
  };
}

function parseBillingResponse(raw: unknown): BillingResponse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('AI_BILLING_UNAVAILABLE', 'The billing service could not confirm this proposal.');
  }
  const value = raw as Record<string, unknown>;
  if (value.ok !== true) {
    const code = typeof value.errorCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.errorCode)
      ? value.errorCode : 'BILLING_UNAVAILABLE';
    const safe = code === 'BILLING_BUDGET' ? 'The configured AI budget has been reached.'
      : code === 'BILLING_QUOTA' ? 'The AI request limit has been reached.'
        : code === 'MODEL_NOT_CONFIGURED' ? 'AI proposals are not configured for this workspace.'
          : code === 'BILLING_CONFLICT' ? 'This command was already used for a different proposal.'
            : 'The billing service could not accept this proposal.';
    fail(code, safe);
  }
  const parsed = billingSuccessSchema.safeParse(value);
  if (!parsed.success) fail('AI_BILLING_UNAVAILABLE', 'The billing service returned an invalid result.');
  return parsed.data;
}

async function billingCall(env: Env, path: string, binding: BillingBinding, extras: Record<string, unknown> = {}): Promise<BillingResponse> {
  try {
    const durableObject = env.BILLING.get(env.BILLING.idFromName('global'));
    const response = await durableObject.fetch(`https://billing.internal${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...binding, ...extras }),
    });
    if (!response.ok) {
      const raw = await response.json().catch(() => null) as unknown;
      return parseBillingResponse(raw);
    }
    return parseBillingResponse(await response.json() as unknown);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    fail('AI_BILLING_UNAVAILABLE', 'The billing service could not confirm this proposal.');
  }
}

function safeProviderFailure(error: unknown): DomainError {
  const allowed = new Set([
    'MODEL_PROVIDER_INPUT_INVALID', 'MODEL_PROVIDER_INPUT_TOO_LARGE', 'MODEL_PROVIDER_OUTPUT_REJECTED',
    'MODEL_PROVIDER_RESPONSE_INVALID', 'MODEL_PROVIDER_RESPONSE_TOO_LARGE', 'MODEL_PROVIDER_HTTP_ERROR',
    'MODEL_PROVIDER_REQUEST_FAILED', 'MODEL_PROVIDER_TIMEOUT', 'MODEL_PROVIDER_ABORTED',
    'MODEL_PROVIDER_NOT_CONFIGURED',
  ]);
  const code = error instanceof DomainError && allowed.has(error.code) ? error.code : 'MODEL_PROVIDER_REQUEST_FAILED';
  const message = code === 'MODEL_PROVIDER_TIMEOUT' ? 'The model proposal timed out.'
    : code === 'MODEL_PROVIDER_OUTPUT_REJECTED' ? 'The model returned a proposal that failed validation.'
      : code === 'MODEL_PROVIDER_INPUT_TOO_LARGE' ? 'The proposal request exceeds the allowed size.'
        : code === 'MODEL_PROVIDER_ABORTED' ? 'The model proposal was cancelled.'
          : 'The model proposal could not be completed.';
  return new DomainError(code, message);
}

function validateChange(kind: WorkspaceView['kind'], raw: unknown): ChangeSet {
  const parsed = kind === 'invoice' ? invoiceChangeSchema.safeParse(raw)
    : kind === 'teaching' ? teachingChangeSchema.safeParse(raw)
      : kind === 'table' ? tableChangeSchema.safeParse(raw) : encounterChangeSchema.safeParse(raw);
  if (!parsed.success) fail('MODEL_PROVIDER_OUTPUT_REJECTED', 'The model returned a proposal that failed validation.');
  return parsed.data;
}

async function settleUsage(env: Env, binding: BillingBinding, usage: BillingUsage): Promise<void> {
  try {
    const settled = await billingCall(env, '/settle', binding, { outcome: 'settled', usage });
    if (settled.status === 'settled') return;
  } catch {
    // A lost acknowledgement is resolved below through the idempotent ledger status.
  }
  try {
    const current = await billingCall(env, '/status', binding);
    if (current.status === 'settled') return;
    const retried = await billingCall(env, '/settle', binding, { outcome: 'settled', usage });
    if (retried.status === 'settled') return;
  } catch {
    // Provider usage is known, but without a confirmed settlement no draft is returned.
  }
  fail('AI_BILLING_UNCERTAIN', 'The billing service could not confirm the model usage; no proposal was returned.');
}

/** Reserve one bounded provider attempt in the existing global ledger. */
export async function reserveAIUsage(
  env: Env,
  binding: AIBillingBinding,
  maxInputTokens: number,
  maxOutputTokens: number,
): Promise<void> {
  billingConfigured(env);
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1 || maxInputTokens > MAX_PROVIDER_INPUT_TOKENS
    || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > TABLE_MAX_OUTPUT_TOKENS) {
    fail('MODEL_PROVIDER_INPUT_TOO_LARGE', 'The model request exceeds the allowed size.');
  }
  const maxReservation = priceMicroUsd(maxInputTokens, maxOutputTokens);
  if (!Number.isSafeInteger(maxReservation) || maxReservation <= 0) {
    fail('AI_INPUT_INVALID', 'The model request is invalid.');
  }
  await billingCall(env, '/reserve', binding, { maxInputTokens, maxOutputTokens });
  const dispatch = await billingCall(env, '/dispatch', binding);
  if (dispatch.claimed !== true) {
    fail('AI_REQUEST_ALREADY_DISPATCHED', 'This model request has already been attempted or is uncertain.');
  }
}

/** Settle a completed provider attempt using the provider-reported token usage. */
export async function settleAIUsage(env: Env, binding: AIBillingBinding, usage: BillingUsage): Promise<void> {
  await settleUsage(env, binding, usage);
}

/** Mark an attempt uncertain when the provider outcome or usage cannot be confirmed. */
export async function markAIUsageUncertain(env: Env, binding: AIBillingBinding): Promise<void> {
  try {
    await billingCall(env, '/settle', binding, { outcome: 'uncertain' });
  } catch {
    // If the ledger cannot be reached, its dispatch lease will expire as uncertain.
  }
}

/**
 * F064: research reports progress on F050's channel so a waiting card needs no second transport.
 * The counters stay at zero because the draft itself has not started streaming yet.
 */
export function searchChangeProgress(event: ModelJobSearchProgress): DeepSeekChangeProgress {
  return { receivedChars: 0, reasoningChars: 0, search: event };
}

/**
 * Returns a validated proposal only. The room authority must recheck its current session,
 * membership, epoch, and revision before committing `change` as evolve.propose.
 */
export async function proposeChange(
  env: Env,
  rawRequest: AIProposalRequest,
  fetchImpl?: typeof fetch,
  onProgress?: (progress: DeepSeekChangeProgress) => void,
): Promise<AIProposalResult> {
  const parsed = requestSchema.safeParse(rawRequest);
  if (!parsed.success) fail('AI_INPUT_INVALID', 'Provide a bounded proposal request and explicit consent.');
  const request = parsed.data;
  billingConfigured(env);
  actorAndRole(request);
  const prepared = prepareInput(request);
  // F064: the drafter decides for itself whether this request needs the web. A search fault
  // must never block a draft, so research is best-effort and bounded. A caller-injected fetch is a
  // test double, so research stays off there and tests never reach the network.
  let researchBlock: { brief: string; sources: { id: string; title: string; url: string; date: string | null; authority: number; summary: string }[] } | undefined;
  if (prepared.kind === 'table' && fetchImpl === undefined && env.TABLE_WEB_SEARCH !== 'off') {
    try {
      const research = await runResearch(request.prompt, {
        apiKey: env.DEEPSEEK_KEY!,
        fetchImpl,
        timeoutMs: 30_000,
        onProgress: (event) => onProgress?.(searchChangeProgress(event)),
      });
      if (research.sources.length > 0) {
        researchBlock = {
          brief: research.brief,
          sources: research.sources.map(({ id, title, url, date, authority, summary }) => ({ id, title, url, date, authority, summary })),
        };
      }
    } catch {
      // Research is an enhancement: fall back to the deterministic draft path.
    }
  }
  const tableProviderInput = prepared.kind === 'table' && prepared.providerInput.kind === 'table'
    ? (researchBlock ? { ...prepared.providerInput, research: researchBlock } : prepared.providerInput)
    : null;
  const providerBytes = new TextEncoder().encode(canonical(tableProviderInput ?? prepared.providerInput)).byteLength;
  if (providerBytes > prepared.maximumInputBytes) {
    fail('MODEL_PROVIDER_INPUT_TOO_LARGE', 'The proposal request exceeds the allowed size.');
  }
  let maxInputTokens: number;
  if (prepared.kind === 'table' && tableProviderInput) {
    try {
      maxInputTokens = measureDeepSeekChangeRequest(tableProviderInput) + TABLE_REQUEST_TOKEN_MARGIN;
    } catch (error) {
      throw safeProviderFailure(error);
    }
  } else {
    maxInputTokens = Math.max(1, providerBytes + PROVIDER_OVERHEAD_BYTES);
  }
  const inputTokenLimit = prepared.kind === 'table' ? MAX_PROVIDER_INPUT_TOKENS : MAX_STANDARD_PROVIDER_INPUT_TOKENS;
  if (maxInputTokens > inputTokenLimit) fail('MODEL_PROVIDER_INPUT_TOO_LARGE', 'The proposal request exceeds the allowed size.');
  const maxReservation = priceMicroUsd(maxInputTokens, prepared.maxOutputTokens);
  if (!Number.isSafeInteger(maxReservation) || maxReservation <= 0) {
    fail('AI_INPUT_INVALID', 'The proposal request is invalid.');
  }

  const { workspace } = request;
  const bindingBase = {
    actorId: request.actorId,
    workspaceId: workspace.id,
    epoch: workspace.epoch,
  };
  const commandBinding = { ...bindingBase, commandId: request.commandId };
  const bindingText = canonical(commandBinding);
  const [jobId, inputHash] = await Promise.all([
    sha256(`tabletop-ai-job-v1:${bindingText}`),
    sha256(canonical({
      ...commandBinding,
      revision: workspace.revision,
      kind: workspace.kind,
      prompt: request.prompt,
      sourceId: request.sourceId ?? null,
      data: prepared.hashInput,
    })),
  ]);
  const binding: BillingBinding = { id: jobId, ...bindingBase, inputHash };
  await billingCall(env, '/reserve', binding, {
    maxInputTokens,
    maxOutputTokens: prepared.maxOutputTokens,
  });
  const dispatch = await billingCall(env, '/dispatch', binding);
  if (dispatch.claimed !== true) {
    fail('AI_PROPOSAL_ALREADY_DISPATCHED', 'This proposal request has already been dispatched or is uncertain.');
  }
  if (prepared.kind === 'table' && prepared.providerInput.kind === 'table' && tableProviderInput) {
    return proposeGeneratedTable(env, request, tableProviderInput, binding, fetchImpl, onProgress);
  }

  let change: ChangeSet;
  let usage: DeepSeekUsage;
  try {
    if (prepared.kind === 'invoice') {
      const provider = new DeepSeekProvider({
        apiKey: env.DEEPSEEK_KEY!,
        fetch: fetchImpl,
        maxTokens: INVOICE_MAX_OUTPUT_TOKENS,
        timeoutMs: 30_000,
      });
      const result = await provider.proposeWithUsage(prepared.providerInput, new AbortController().signal);
      change = validateChange(workspace.kind, result.change);
      usage = result.usage;
    } else {
      const provider = new DeepSeekChangeProvider({ apiKey: env.DEEPSEEK_KEY!, fetch: fetchImpl, timeoutMs: 30_000 });
      const result = await provider.propose(prepared.providerInput, new AbortController().signal);
      change = validateChange(workspace.kind, 'change' in result ? result.change : null);
      if (workspace.domain.kind === 'table' && change.kind === 'table'
          && aiTableChangeIssues(workspace.domain, change).length > 0) {
        fail('MODEL_PROVIDER_OUTPUT_REJECTED', 'The model returned table rules that do not fit the current sources and active records.');
      }
      usage = result.usage;
    }
  } catch (error) {
    try {
      await billingCall(env, '/settle', binding, { outcome: 'uncertain' });
    } catch {
      // The active lease will expire into uncertain while its reservation remains charged.
    }
    throw safeProviderFailure(error);
  }

  await settleUsage(env, binding, mapUsage(usage));
  return { change, jobId, usage };
}

/** Every repair is independently reserved and settled; no retries of transport failures. */
async function proposeGeneratedTable(
  env: Env,
  request: AIProposalRequest,
  initialInput: Extract<DeepSeekChangeInput, { kind: 'table' }>,
  initialBinding: BillingBinding,
  fetchImpl?: typeof fetch,
  onProgress?: (progress: DeepSeekChangeProgress) => void,
): Promise<AIProposalResult> {
  let input = initialInput;
  let binding = initialBinding;
  // F045: one configured deadline covers every repair attempt of this draft.
  const deadlineMs = aiTableDeadlineMs(env);
  const jobStartedAt = Date.now();
  const deadline = jobStartedAt + deadlineMs;
  const MAX_ATTEMPTS = 4;
  const total: DeepSeekUsage = { promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
  let previousIssues: string[] = [];
  let lastProgress: DeepSeekChangeProgress = { receivedChars: 0, reasoningChars: 0 };
  // Our own deadline ended the job; the caller reports it as one failed rule draft.
  const deadlineTimeout = (): ModelRequestTimeout => new ModelRequestTimeout({
    timedOutBy: 'server',
    limitMs: deadlineMs,
    elapsedMs: Math.max(0, Date.now() - jobStartedAt),
    receivedChars: lastProgress.receivedChars,
    reasoningChars: lastProgress.reasoningChars,
  });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let change: ChangeSet | undefined;
    let clarification: TableClarification | undefined;
    let usage: DeepSeekUsage;
    let issues: string[] = [];
    let previousOutput: string | undefined;
    try {
      const remaining = deadline - Date.now();
      if (remaining < 1) throw deadlineTimeout();
      const provider = new DeepSeekChangeProvider({ apiKey: env.DEEPSEEK_KEY!, fetch: fetchImpl, timeoutMs: remaining });
      const result = await provider.propose(input, new AbortController().signal, (progress) => {
        lastProgress = progress;
        onProgress?.(progress);
      });
      if ('clarification' in result) clarification = result.clarification;
      else change = result.change;
      usage = result.usage;
    } catch (error) {
      if (error instanceof RejectedChangeReply) {
        usage = error.usage;
        issues = error.issues;
        previousOutput = error.previousOutput;
      } else {
        await markAIUsageUncertain(env, binding);
        if (error instanceof ModelStreamFailure) {
          // The provider reports its own bounded attempt; the job reports the whole-job deadline.
          const details = {
            ...error.details,
            limitMs: deadlineMs,
            elapsedMs: Math.max(0, Date.now() - jobStartedAt),
          };
          throw error instanceof ModelRequestTimeout ? new ModelRequestTimeout(details)
            : error instanceof ModelProviderClosed ? new ModelProviderClosed(details)
              : new ModelStreamFailure(error.code, error.message, details);
        }
        throw safeProviderFailure(error);
      }
    }
    await settleUsage(env, binding, mapUsage(usage));
    total.promptTokens += usage.promptTokens;
    total.completionTokens += usage.completionTokens;
    total.cacheHitTokens += usage.cacheHitTokens;
    total.cacheMissTokens += usage.cacheMissTokens;
    if (usage.reasoningTokens !== undefined) total.reasoningTokens = (total.reasoningTokens ?? 0) + usage.reasoningTokens;
    if (clarification) return { clarification, jobId: initialBinding.id, usage: total };
    if (change?.kind === 'table' && request.workspace.domain.kind === 'table') {
      // F067: the minimal fallback has no repair left, so a table that activates beats rejecting its sample button.
      const check = attempt === MAX_ATTEMPTS ? tableChangeIssues : aiTableChangeIssues;
      issues = check(request.workspace.domain, change).slice(0, 4).map(issue => issue.slice(0, 1000));
      if (!issues.length) return { change, jobId: initialBinding.id, usage: total };
      previousOutput = JSON.stringify(change).slice(0, 18_000);
    }
    if (attempt === MAX_ATTEMPTS || !issues.length) throw new ReasonedDomainError('MODEL_PROVIDER_OUTPUT_REJECTED', 'The generated tool did not pass validation. Nothing was activated.', issues);
    if (Date.now() >= deadline) throw deadlineTimeout();
    if (attempt === MAX_ATTEMPTS - 1) {
      // F028: the final attempt asks for the smallest table that can still activate.
      previousIssues = issues;
      const editing = initialInput.kind === 'table' && initialInput.program !== null;
      input = { ...initialInput, repair: { attempt: FALLBACK_REPAIR_ATTEMPT, issues: [...(editing ? EDIT_FALLBACK_SIMPLIFY_ISSUES : FALLBACK_SIMPLIFY_ISSUES)] } };
    } else {
      const repairIssues = nextRepairIssues(previousIssues, issues);
      previousIssues = issues;
      input = { ...initialInput, repair: { attempt: (attempt + 1) as 2 | 3, issues: repairIssues, ...(previousOutput === undefined ? {} : { previousOutput }) } };
    }
    let maxInputTokens: number;
    for (;;) {
      try {
        maxInputTokens = measureDeepSeekChangeRequest(input) + TABLE_REQUEST_TOKEN_MARGIN;
        break;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'MODEL_PROVIDER_INPUT_TOO_LARGE' || !input.repair?.previousOutput) throw error;
        const excerpt = input.repair.previousOutput;
        input = { ...input, repair: { attempt: attempt + 1, issues, ...(excerpt.length > 256 ? { previousOutput: excerpt.slice(0, Math.floor(excerpt.length / 2)) } : {}) } };
      }
    }
    if (maxInputTokens > MAX_PROVIDER_INPUT_TOKENS) fail('MODEL_PROVIDER_INPUT_TOO_LARGE', 'The repair request exceeds the allowed size.');
    binding = {
      ...initialBinding,
      id: await sha256(`${initialBinding.id}:repair:${attempt + 1}`),
      inputHash: await sha256(canonical({ initial: initialBinding.inputHash, input })),
    };
    await billingCall(env, '/reserve', binding, { maxInputTokens, maxOutputTokens: TABLE_MAX_OUTPUT_TOKENS });
    const dispatch = await billingCall(env, '/dispatch', binding);
    if (dispatch.claimed !== true) fail('AI_PROPOSAL_ALREADY_DISPATCHED', 'This repair request has already been dispatched.');
  }
  return fail('MODEL_PROVIDER_OUTPUT_REJECTED', 'The generated tool did not pass validation.');
}

export { invoiceChangeSchema, teachingChangeSchema, encounterChangeSchema };

