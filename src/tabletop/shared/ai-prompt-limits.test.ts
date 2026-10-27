import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_ASSISTANT_PROMPT_CHARS, MAX_DRAFT_PROMPT_CHARS } from './ai-prompt-limits';
import { tableAssistantRequestSchema } from './table-assistant-contracts';

/**
 * F078-T13: the two AI prompt caps were written as the literal `4_000`/`4000` in
 * the contract schemas, the Worker routes, the provider schemas and the job
 * repository. They now come from one leaf module; this test proves the values,
 * the contract behavior and that a new literal cannot quietly come back.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));

function source(relativePath: string): string {
  return readFileSync(`${root}${relativePath}`, 'utf8');
}

describe('AI prompt limits', () => {
  it('exposes one owner for the draft and assistant prompt caps', () => {
    expect(MAX_DRAFT_PROMPT_CHARS).toBe(4_000);
    expect(MAX_ASSISTANT_PROMPT_CHARS).toBe(4_000);
  });

  it('keeps the assistant request contract at the shared cap', () => {
    const request = (prompt: string) => ({
      commandId: '00000000-0000-4000-8000-000000000000',
      expectedRevision: 'a'.repeat(64),
      expectedEpoch: 1,
      prompt,
      consent: true,
    });
    expect(tableAssistantRequestSchema.safeParse(request('a'.repeat(MAX_ASSISTANT_PROMPT_CHARS))).success).toBe(true);
    expect(tableAssistantRequestSchema.safeParse(request('a'.repeat(MAX_ASSISTANT_PROMPT_CHARS + 1))).success).toBe(false);
  });

  it('has no prompt-cap literal left in the contract, Worker routes or provider schemas', () => {
    const files = [
      'src/tabletop/shared/table-assistant-contracts.ts',
      'cloudflare/room.ts',
      'cloudflare/room-job-view.ts',
      'cloudflare/room-repository.ts',
      'cloudflare/table-assistant.ts',
      'cloudflare/ai.ts',
      'server/providers/deepseek.ts',
      'server/providers/deepseek-changes.ts',
    ];
    const promptLiteral = /prompt:\s*z\.string\([^)]*\)\.max\(\s*(?:4_000|4000)\s*\)/u;
    const capAssignment = /(?:MAX_PROMPT_CHARS|MAX_MODEL_PROMPT_CHARS|MAX_TABLE_ASSISTANT_PROMPT_CHARS)\s*=\s*(?:4_000|4000)\b/u;
    /** F078-T18: a length guard is a prompt cap too; it must read the owner constant as well. */
    const promptLengthLiteral = /prompt\.length\s*(?:<=?|>=?)\s*(?:4_000|4000)\b/u;
    const offenders = files.filter((file) => {
      const text = source(file);
      return promptLiteral.test(text) || capAssignment.test(text) || promptLengthLiteral.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
