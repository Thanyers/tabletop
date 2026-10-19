import type { TableAction, TableChange, TableCondition, TableEffect } from '../shared/table-contracts';

/** Authored synthetic interpreter fixture; not a model response or browser-upload proof. */
export const helpdeskSource = {
  filename: 'office-helpdesk.md',
  text: '# Office Helpdesk\nClaim only open tickets. Only the assignee may submit work with a nonblank completion note. Only the owner may approve reviewed work, reopen completed work, or authorize a blocked access request. Reopening clears the assignee and note.\nTickets: printer (open), wifi (open), access (blocked, requires approval).',
};

export function helpdeskChange(sourceId: string): TableChange {
  const status = (value: string): TableCondition => ({ left: { record: 'ticket', field: 'status' }, op: 'eq', right: { literal: value }, message: `Ticket must be ${value}.` });
  const set = (field: string, value: string | boolean | null): TableEffect => ({ record: 'ticket', field, op: 'set', value: { literal: value } });
  const action = (id: string, title: string, conditions: TableCondition[], effects: TableEffect[], ownerOnly = false): TableAction => ({
    id, title, description: title, roles: ownerOnly ? ['owner'] : ['owner', 'participant'],
    parameters: [{ id: 'ticket', label: 'Ticket', type: 'record', collection: 'tickets' }],
    conditions, effects, requireTurn: false, advanceTurn: false,
  });
  const claim = action('claim', 'Claim ticket', [status('open'), { left: { record: 'ticket', field: 'requires_approval' }, op: 'eq', right: { literal: false }, message: 'Owner authorization is required.' }], [set('status', 'in_progress'), { record: 'ticket', field: 'assignee', op: 'set', value: { system: 'actor' } }]);
  const submit = action('submit', 'Submit for review', [status('in_progress'), { left: { record: 'ticket', field: 'assignee' }, op: 'eq', right: { system: 'actor' }, message: 'Only the assignee can submit this ticket.' }], [set('status', 'review'), { record: 'ticket', field: 'completion_note', op: 'set', value: { input: 'note' } }]);
  submit.parameters.push({ id: 'note', label: 'Completion note', type: 'text' });
  return {
    kind: 'table',
    program: {
      version: 1, title: 'Office Helpdesk', description: 'Review service work before closing a ticket.',
      collections: [{ id: 'tickets', title: 'Helpdesk tickets', fields: [
        { id: 'title', label: 'Work', type: 'text', required: true },
        { id: 'status', label: 'Status', type: 'text', required: true, choices: ['open', 'in_progress', 'review', 'done', 'blocked'] },
        { id: 'assignee', label: 'Assignee', type: 'text', required: false },
        { id: 'completion_note', label: 'Completion note', type: 'text', required: false },
        { id: 'requires_approval', label: 'Needs authorization', type: 'boolean', required: true },
      ] }],
      actions: [claim, submit,
        action('approve', 'Approve work', [status('review')], [set('status', 'done')], true),
        action('reopen', 'Reopen work', [status('done')], [set('status', 'open'), set('assignee', null), set('completion_note', null)], true),
        action('authorize', 'Authorize access request', [status('blocked')], [set('status', 'open'), set('requires_approval', false)], true),
      ],
      invariants: [], turnOrder: [], assumptions: [],
      evidence: [{ sourceId, quote: 'Only the assignee may submit work with a nonblank completion note.' }],
    },
    initialRecords: { tickets: [
      { id: 'printer', values: { title: 'Fix floor-2 printer', status: 'open', assignee: null, completion_note: null, requires_approval: false } },
      { id: 'wifi', values: { title: 'Diagnose meeting-room Wi-Fi', status: 'open', assignee: null, completion_note: null, requires_approval: false } },
      { id: 'access', values: { title: 'Prepare access request', status: 'blocked', assignee: null, completion_note: null, requires_approval: true } },
    ] },
  };
}
