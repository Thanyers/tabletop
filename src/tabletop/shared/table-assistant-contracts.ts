import { z } from 'zod';
import type { WorkspaceView } from './contracts.js';
import type { TableValue } from './table-contracts.js';

const revisionTokenSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const commandIdSchema = z.string().uuid();
const safeLabelSchema = z.string().min(1).max(200);
const boundedIdSchema = z.string().min(1).max(160);
const tableValueSchema: z.ZodType<TableValue> = z.union([
  z.string().max(500),
  z.number().finite().min(-1_000_000_000).max(1_000_000_000),
  z.boolean(),
  z.null(),
  z.array(z.string().max(100)).max(32),
]);

export const tableAssistantReferenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rule'), id: boundedIdSchema, label: safeLabelSchema }),
  z.strictObject({ kind: z.literal('action'), id: boundedIdSchema, label: safeLabelSchema }),
  z.strictObject({ kind: z.literal('record'), collectionId: boundedIdSchema, id: boundedIdSchema, label: safeLabelSchema }),
  z.strictObject({ kind: z.literal('field'), collectionId: boundedIdSchema, id: boundedIdSchema, label: safeLabelSchema }),
  z.strictObject({ kind: z.literal('turn'), seat: z.enum(['host', 'member-1', 'member-2', 'member-3', 'member-4', 'member-5', 'member-6', 'member-7']), label: safeLabelSchema }),
]);

export const tableAssistantResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('build-request'), text: z.string().min(1).max(8_000) }),
  z.strictObject({
    kind: z.literal('explanation'),
    text: z.string().min(1).max(8_000),
    references: z.array(tableAssistantReferenceSchema).max(40),
  }),
  z.strictObject({
    kind: z.literal('action-proposal'),
    text: z.string().min(1).max(8_000),
    actionId: boundedIdSchema,
    inputs: z.record(z.string().max(160), tableValueSchema).refine((value) => Object.keys(value).length <= 20),
    expectedRevision: revisionTokenSchema,
    expectedRuleRevision: z.number().int().nonnegative().safe(),
    expectedActionRevision: z.number().int().nonnegative().safe(),
    confirmationRequired: z.literal(true),
  }),
  z.strictObject({ kind: z.literal('clarification'), text: z.string().min(1).max(8_000) }),
  z.strictObject({ kind: z.literal('refusal'), text: z.string().min(1).max(8_000) }),
]);

export const tableAssistantRequestSchema = z.strictObject({
  commandId: commandIdSchema,
  expectedRevision: revisionTokenSchema,
  expectedEpoch: z.number().int().positive().safe(),
  prompt: z.string().trim().min(3).max(4_000),
  consent: z.literal(true),
});

export const tableAssistantConfirmationSchema = z.strictObject({
  commandId: commandIdSchema,
  expectedRevision: revisionTokenSchema,
  expectedEpoch: z.number().int().positive().safe(),
});

export const tableAssistantConversationEntrySchema = z.strictObject({
  contextSource: z.literal('recalled').optional(),
  prompt: z.string().min(1).max(4_000),
  result: z.strictObject({
    kind: z.enum(['explanation', 'action-proposal', 'clarification', 'refusal', 'build-request']),
    text: z.string().min(1).max(8_000),
  }),
  expectedRevision: revisionTokenSchema,
  confirmationStatus: z.enum(['available', 'processing', 'confirmed', 'stale', 'rejected']).optional(),
});

export const tableAssistantJobSchema = z.strictObject({
  id: revisionTokenSchema,
  /** Opaque actor id of the member who asked; lets open history (F034) label other members' chats. */
  askedBy: z.string().min(1).max(200).optional(),
  createdAt: z.number().int().nonnegative().safe(),
  prompt: z.string().min(1).max(4_000),
  status: z.enum(['running', 'completed', 'failed']),
  expectedRevision: revisionTokenSchema,
  expectedEpoch: z.number().int().positive().safe(),
  message: z.string().max(500).optional(),
  /** Machine-readable failure for tests and support: e.g. MODEL_PROVIDER_TIMEOUT, ASSISTANT_INTERRUPTED. */
  failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/u).optional(),
  /** Sanitized validation reasons (max 3) when the assistant's answer was rejected. */
  failureReasons: z.array(z.string().min(1).max(240)).max(3).optional(),
  /** How long the job ran before failing; a ~180s value points at the provider deadline. */
  durationMs: z.number().int().nonnegative().max(3_600_000).optional(),
  result: tableAssistantResultSchema.optional(),
  confirmationStatus: z.enum(['available', 'processing', 'confirmed', 'stale', 'rejected']).optional(),
  serverOmittedConversationEntries: z.number().int().nonnegative().max(500).optional(),
  providerOmittedConversationEntries: z.number().int().nonnegative().max(500).optional(),
});

export const tableAssistantHistoryPageSchema = z.strictObject({
  items: z.array(tableAssistantJobSchema).max(50),
  nextBefore: revisionTokenSchema.nullable(),
  limit: z.number().int().positive().max(50),
  contextTurns: z.literal(6),
  contextMaxBytes: z.literal(16_384),
  storageJobCap: z.literal(500),
});

export type TableAssistantReference = z.infer<typeof tableAssistantReferenceSchema>;
export type TableAssistantResult = z.infer<typeof tableAssistantResultSchema>;
export type TableAssistantRequest = z.infer<typeof tableAssistantRequestSchema>;
export type TableAssistantConfirmation = z.infer<typeof tableAssistantConfirmationSchema>;
export type TableAssistantJob = z.infer<typeof tableAssistantJobSchema>;
export type TableAssistantConversationEntry = z.infer<typeof tableAssistantConversationEntrySchema>;
export type TableAssistantHistoryPage = z.infer<typeof tableAssistantHistoryPageSchema>;
export interface TableAssistantInput {
  workspace: WorkspaceView;
  actorId: string;
  jobId: string;
  commandId: string;
  prompt: string;
  consent: true;
  conversation: TableAssistantConversationEntry[];
  conversationOmittedCount: number;
}
