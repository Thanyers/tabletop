import { describe, expect, it } from 'vitest';
import { resolveTableRuleReferences } from './table-rule-reference';
import { createTableState } from '../domain/table';
import { equipmentChange } from '../testing/table-scenarios';

function table() {
  return { ...createTableState(), program: equipmentChange('source_equipment').program };
}

describe('authoritative selected-rule context', () => {
  it('resolves the exact current rule even when its visible name changed', () => {
    const state = table();
    state.program.actions[0].title = 'Borrow camera';
    expect(resolveTableRuleReferences('[[table-rule:action:borrow]] Make this easier', state))
      .toContain('id="borrow", current name="Borrow camera"');
  });
  it('rejects removed rules and malformed markers rather than referring to another rule', () => {
    expect(() => resolveTableRuleReferences('[[table-rule:action:missing]] change it', table())).toThrow(/Select it again/u);
    expect(() => resolveTableRuleReferences('[[table-rule:bogus:borrow]] change it', table())).toThrow();
    expect(() => resolveTableRuleReferences('[[table-rule:action:../../borrow]] change it', table())).toThrow();
  });
  it('does not rewrite an ordinary prompt or a card-level reference', () => {
    const prompt = 'Make this card smaller';
    expect(resolveTableRuleReferences(prompt, table())).toBe(prompt);
  });
  it('bounds expansion without silently truncating the requested change', () => {
    expect(() => resolveTableRuleReferences('[[table-rule:action:borrow]]'.repeat(6), table())).toThrow(/five/u);
    expect(() => resolveTableRuleReferences('x'.repeat(3980) + '[[table-rule:action:borrow]]', table())).toThrow(/Shorten/u);
  });
});
