import { describe, expect, it } from 'vitest';
import { AuthorityError } from '../server/errors.js';
import { DomainError } from '../src/tabletop/shared/contracts.js';
import { MAX_FAILURE_REASON_CHARS, ReasonedDomainError, cleanReasons, modelFailureMessage, safeModelFailureCode, safeModelFailureReasons } from './model-failure.js';

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
