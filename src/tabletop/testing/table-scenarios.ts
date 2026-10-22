import type { TableAction, TableChange, TableField, TableOperand, TableProgram } from '../shared/table-contracts';

/** Synthetic fixtures used to test the interpreter. Live model responses are tested separately. */
export const tableScenarioSources = {
  equipment: { filename: 'equipment-loans.md', text: '# Community equipment library\nOnly available equipment may be borrowed. Only its borrower may return it.\n\n| id | name | available | borrower |\n| camera | Field camera | true | |\n| tripod | Tripod | true | |\n' },
  shifts: { filename: 'team-shifts.json', text: '{"policy":"Swap two different people only when both are available for their new slot. Each slot can have only one person. You may initiate a swap only for your own seat.","people":[{"id":"ada","name":"Ada","seat":"host","slot":"morning","available":["morning","evening"]},{"id":"bo","name":"Bo","seat":"member-1","slot":"evening","available":["morning","evening"]},{"id":"cy","name":"Cy","seat":"member-2","slot":"night","available":["night"]}]}' },
  game: { filename: 'river-race.txt', text: 'River Race: two players use host and member-1 seats. Host goes first. On your turn, advance your own boat by 2 points and then pass the turn. Scores must stay between 0 and 20. Start both boats at zero. The owner can propose a new scoring rule mid-game without resetting scores.\nBoats: red (host), blue (member-1).' },
};
const textField = (id: string, required = true): TableField => ({ id, label: id, type: 'text', required });
const literal = (v: string | number | boolean | null): TableOperand => ({ literal: v });
const record = (parameter: string, field: string): TableOperand => ({ record: parameter, field });
const baseAction = (id: string): TableAction => ({ id, title: id, description: id, roles: ['owner', 'participant'], parameters: [], conditions: [], effects: [], requireTurn: false, advanceTurn: false });
function baseProgram(title: string, sourceId: string, quote: string): TableProgram { return { version: 1, title, description: title, collections: [], actions: [], invariants: [], turnOrder: [], evidence: [{ sourceId, quote }], assumptions: [] }; }

export function equipmentChange(sourceId: string): TableChange {
  const program = baseProgram('Community equipment', sourceId, 'Only available equipment may be borrowed. Only its borrower may return it.');
  program.collections = [{ id: 'equipment', title: 'Equipment', fields: [textField('name'), { id: 'available', label: 'Available', type: 'boolean', required: true }, textField('borrower', false)] }];
  const borrow = baseAction('borrow'), giveBack = baseAction('return');
  for (const a of [borrow, giveBack]) a.parameters = [{ id: 'item', label: 'Equipment', type: 'record', collection: 'equipment' }];
  borrow.conditions = [{ left: record('item', 'available'), op: 'eq', right: literal(true), message: 'This item is already reserved.' }];
  borrow.effects = [{ record: 'item', field: 'available', op: 'set', value: literal(false) }, { record: 'item', field: 'borrower', op: 'set', value: { system: 'actor' } }];
  giveBack.conditions = [{ left: record('item', 'borrower'), op: 'eq', right: { system: 'actor' }, message: 'Only the borrower may return this item.' }];
  giveBack.effects = [{ record: 'item', field: 'available', op: 'set', value: literal(true) }, { record: 'item', field: 'borrower', op: 'set', value: literal(null) }];
  program.actions = [borrow, giveBack];
  return { kind: 'table', program, initialRecords: { equipment: [{ id: 'camera', values: { name: 'Field camera', available: true, borrower: null } }, { id: 'tripod', values: { name: 'Tripod', available: true, borrower: null } }] } };
}
export function shiftsChange(sourceId: string): TableChange {
  const program = baseProgram('Team shift exchange', sourceId, 'Swap two different people only when both are available for their new slot.');
  program.collections = [{ id: 'people', title: 'Shift roster', fields: [textField('name'), textField('seat'), textField('slot'), { id: 'available', label: 'Available slots', type: 'list', required: true }] }];
  const swap = baseAction('swap'); swap.title = 'Swap shifts';
  swap.parameters = ['first', 'second'].map(id => ({ id, label: id, type: 'record', collection: 'people' }));
  swap.conditions = [
    { left: { input: 'first' }, op: 'neq', right: { input: 'second' }, message: 'Select two different people.' },
    { left: record('first', 'seat'), op: 'eq', right: { system: 'seat' }, message: 'Start with your own shift.' },
    { left: record('first', 'available'), op: 'contains', right: record('second', 'slot'), message: 'The first person is unavailable.' },
    { left: record('second', 'available'), op: 'contains', right: record('first', 'slot'), message: 'The second person is unavailable.' },
  ];
  swap.effects = [{ record: 'first', field: 'slot', op: 'set', value: record('second', 'slot') }, { record: 'second', field: 'slot', op: 'set', value: record('first', 'slot') }];
  program.actions = [swap]; program.invariants = [{ id: 'slot_unique', collection: 'people', fields: ['slot'], message: 'One person per shift.' }];
  program.assumptions = ['The roster has pre-approved exchanges when both people are available.'];
  return { kind: 'table', program, initialRecords: { people: [
    { id: 'ada', values: { name: 'Ada', seat: 'host', slot: 'morning', available: ['morning', 'evening'] } },
    { id: 'bo', values: { name: 'Bo', seat: 'member-1', slot: 'evening', available: ['morning', 'evening'] } },
    { id: 'cy', values: { name: 'Cy', seat: 'member-2', slot: 'night', available: ['night'] } },
  ] } };
}
export function gameChange(sourceId: string): TableChange {
  const program = baseProgram('River Race', sourceId, 'On your turn, advance your own boat by 2 points and then pass the turn.');
  program.collections = [{ id: 'boats', title: 'Boats and scores', fields: [textField('seat'), { id: 'score', label: 'Score', type: 'number', required: true, min: 0, max: 20 }] }];
  const advance = baseAction('advance'); advance.title = 'Advance boat'; advance.parameters = [{ id: 'boat', label: 'Your boat', type: 'record', collection: 'boats' }];
  advance.conditions = [{ left: record('boat', 'seat'), op: 'eq', right: { system: 'seat' }, message: 'Choose your own boat.' }];
  advance.effects = [{ record: 'boat', field: 'score', op: 'add', value: literal(2) }]; advance.requireTurn = true; advance.advanceTurn = true;
  program.actions = [advance]; program.turnOrder = ['host', 'member-1'];
  return { kind: 'table', program, initialRecords: { boats: [{ id: 'red', values: { seat: 'host', score: 0 } }, { id: 'blue', values: { seat: 'member-1', score: 0 } }] } };
}

/**
 * F048: one attack action whose damage comes from a server roll (2d6 + 3). The roll feeds an
 * additive number field and is copied into a created hits row, so a test can read the total back.
 */
export function rollCombatChange(sourceId?: string): TableChange {
  const quote = 'Roll two six-sided dice plus three for damage on your turn.';
  const program = baseProgram('Sparring match', sourceId ?? '', quote);
  program.evidence = sourceId ? [{ sourceId, quote }] : [];
  program.collections = [
    { id: 'fighters', title: 'Fighters', fields: [textField('name'), { id: 'damage_taken', label: 'Damage taken', type: 'number', required: true, min: 0, max: 500 }] },
    { id: 'hits', title: 'Hits', fields: [textField('target'), { id: 'damage', label: 'Damage', type: 'number', required: true, min: 0, max: 500 }] },
  ];
  const attack = baseAction('attack');
  attack.title = 'Attack';
  attack.description = 'Roll damage and record the hit';
  attack.parameters = [
    { id: 'target', label: 'Target', type: 'record', collection: 'fighters' },
    { id: 'damage', label: 'Damage roll', type: 'roll', roll: { groups: [{ count: 2, faces: 6 }], modifier: 3 } },
  ];
  attack.effects = [{ record: 'target', field: 'damage_taken', op: 'add', value: { input: 'damage' } }];
  attack.creates = [{ collection: 'hits', values: { target: { input: 'target' }, damage: { input: 'damage' } } }];
  attack.requireTurn = true;
  program.actions = [attack];
  program.turnOrder = ['host', 'member-1'];
  program.canvas = {
    version: 1,
    views: [{
      id: 'attack-controls', kind: 'controls', title: 'Attack controls',
      controls: [{
        id: 'attack-form', kind: 'form', label: 'Attack', actionId: 'attack',
        inputs: { target: { kind: 'control' }, damage: { kind: 'control' } },
      }],
    }],
  };
  return {
    kind: 'table', program,
    initialRecords: { fighters: [{ id: 'hero', values: { name: 'Hero', damage_taken: 0 } }], hits: [] },
  };
}
