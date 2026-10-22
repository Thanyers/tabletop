import { describe, expect, it } from 'vitest';
import { AuthorityError } from '../server/errors.js';
import { DomainError } from '../src/tabletop/shared/contracts.js';
import { MAX_FAILURE_REASON_CHARS, ReasonedDomainError, STRUCTURAL_HINT, cleanReasons, modelFailureMessage, safeAssistantFailureCode, safeModelFailureCode, safeModelFailureReasons, tableAssistantFailureMessage } from './model-failure.js';

describe('model failure messages (F016)', () => {
  it('shows the real validation reasons instead of one generic sentence', () => {
    const message = modelFailureMessage('MODEL_PROVIDER_OUTPUT_REJECTED', ['A rule edit must retain every current field definition.']);
    expect(message).toContain('did not pass validation: A rule edit must retain every current field definition.');
    expect(modelFailureMessage('MODEL_PROVIDER_OUTPUT_REJECTED')).toBe('The proposed table rules did not pass validation. Review the sources or revise the request, then try again.');
    expect(modelFailureMessage('TABLE_LIMIT', ['Use at most 100 rows.'])).toContain('Use at most 100 rows.');
  });
  it('keeps reasons short, single-line, de-duplicated and capped at three', () => {
    const reasons = cleanReasons(['  one\n\ttwo  ', 'one two', 'x'.repeat(1000), 'three', 'four', 42, '']);
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toBe('one two.');
    expect(reasons[1]).toHaveLength(MAX_FAILURE_REASON_CHARS);
    expect(reasons[1].endsWith('…')).toBe(true);
    expect(cleanReasons('not an array')).toEqual([]);
    expect(cleanReasons(['\u0000\u0007bell'])).toEqual(['bell.']);
    expect(cleanReasons(['program.collections[0].fields[1].type: Invalid option'])).toEqual(['program.collections[0].fields[1].type: Invalid option.']);
  });
  it('rewrites repair instructions meant for the AI into what went wrong', () => {
    expect(cleanReasons(['Return a complete JSON object, without Markdown.'])).toEqual(['The AI did not return a complete draft.']);
    expect(cleanReasons(['Reduce expression nesting and program size to the documented limits.'])).toEqual(['The draft was too large or too deeply nested.']);
  });
  it('extracts reasons only from validation failures', () => {
    expect(safeModelFailureReasons(new ReasonedDomainError('MODEL_PROVIDER_OUTPUT_REJECTED', 'x', ['Field "status" is missing.']))).toEqual(['Field "status" is missing.']);
    expect(safeModelFailureReasons(new DomainError('TABLE_PRESERVE_DATA', 'A rule edit must retain every current collection.'))).toEqual(['A rule edit must retain every current collection.']);
    expect(safeModelFailureReasons(new DomainError('BILLING_BUDGET', 'secret detail'))).toEqual([]);
    expect(safeModelFailureReasons(new AuthorityError('TABLE_READ_ONLY', 'read only', 403))).toEqual([]);
    expect(safeModelFailureReasons(new Error('TABLE_ boom'))).toEqual([]);
    expect(safeModelFailureCode(new DomainError('TABLE_SCHEMA', 'bad'))).toBe('MODEL_PROVIDER_OUTPUT_REJECTED');
  });
});

describe('table assistant failure messages', () => {
  it('names the real cause for every known failure code', () => {
    expect(tableAssistantFailureMessage('MODEL_PROVIDER_TIMEOUT')).toContain('took too long');
    expect(tableAssistantFailureMessage('MODEL_PROVIDER_OUTPUT_TRUNCATED')).toContain('ran out of output space');
    expect(tableAssistantFailureMessage('MODEL_PROVIDER_OUTPUT_TRUNCATED')).toContain('(code MODEL_PROVIDER_OUTPUT_TRUNCATED)');
    expect(tableAssistantFailureMessage('ASSISTANT_INTERRUPTED')).toContain('stopped before it finished');
    expect(tableAssistantFailureMessage('MODEL_PROVIDER_HTTP_ERROR')).toContain('AI provider returned an error');
    expect(tableAssistantFailureMessage('BILLING_BUDGET')).toContain('budget');
    expect(tableAssistantFailureMessage('STALE_WORKSPACE')).toContain('changed while the assistant was working');
    expect(tableAssistantFailureMessage('ACTION_REJECTED')).toContain('not valid for the current table state');
  });

  it('always keeps the failure code visible for tracing', () => {
    expect(tableAssistantFailureMessage('MODEL_PROVIDER_TIMEOUT')).toContain('(code MODEL_PROVIDER_TIMEOUT)');
    expect(tableAssistantFailureMessage('SOMETHING_NEW')).toContain('(code SOMETHING_NEW)');
    expect(tableAssistantFailureMessage(null)).toContain('(code UNKNOWN)');
    expect(safeAssistantFailureCode('MODEL_PROVIDER_TIMEOUT')).toBe('MODEL_PROVIDER_TIMEOUT');
    expect(safeAssistantFailureCode('not a code')).toBe('UNKNOWN');
    expect(safeAssistantFailureCode({ code: 'X' })).toBe('UNKNOWN');
  });

  it('shows sanitized validation reasons for rejected answers', () => {
    const message = tableAssistantFailureMessage('MODEL_PROVIDER_OUTPUT_REJECTED', ['Field "status" is missing.']);
    expect(message).toContain('did not pass table validation: Field "status" is missing.');
    expect(message).toContain('MODEL_PROVIDER_OUTPUT_REJECTED');
    const assistantMessage = tableAssistantFailureMessage('TABLE_ASSISTANT_CONTEXT_TOO_LARGE', ['The conversation is too long.']);
    expect(assistantMessage).toContain('The conversation is too long.');
  });
});

describe('structural reject hint (F027)', () => {
  it('adds the join hint when a reason points at an unknown record field', () => {
    const message = modelFailureMessage('MODEL_PROVIDER_OUTPUT_REJECTED', ['An action refers to an unknown record field.']);
    expect(message).toContain(STRUCTURAL_HINT);
    expect(message).toContain('did not pass validation');
  });

  it('does not add the join hint for unrelated reasons', () => {
    expect(modelFailureMessage('MODEL_PROVIDER_OUTPUT_REJECTED', ['Use at most 100 rows.'])).not.toContain(STRUCTURAL_HINT);
  });
});

