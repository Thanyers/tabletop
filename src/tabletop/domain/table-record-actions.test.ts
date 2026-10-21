import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import type { TableProgram } from '../shared/table-contracts';
import { applyTableChange, createTableState, handleTableCommand, parseBoundedTableChange } from './table';

function invoiceChange(options: {
  roles?: string[];
  requireTurn?: boolean;
  turnOrder?: string[];
  initialRecords?: Record<string, unknown[]>;
  uniqueInvoiceNumber?: boolean;
  existingRecordAction?: boolean;
  invalidAmountOperand?: boolean;
  missingPaidCreateValue?: boolean;
} = {}): unknown {
  const parameters: unknown[] = [
    { id: 'invoice_no', label: 'Invoice number', type: 'text', choices: ['INV-100', 'INV-200'] },
    { id: 'amount', label: 'Amount', type: 'number', min: 0, max: 5000 },
    { id: 'status', label: 'Status', type: 'text', choices: ['draft', 'paid'] },
  ];
  const effects: unknown[] = [];
  if (options.existingRecordAction) {
    parameters.unshift({ id: 'existing', label: 'Existing invoice', type: 'record', collection: 'invoices' });
    effects.push({ record: 'existing', field: 'paid', op: 'set', value: { literal: true } });
  }
  const createValues: Record<string, unknown> = {
    invoice_no: { input: 'invoice_no' },
    amount: { input: options.invalidAmountOperand ? 'status' : 'amount' },
    status: { input: 'status' },
    paid: { literal: false },
  };
  if (options.missingPaidCreateValue) delete createValues.paid;
  const formInputs: Record<string, unknown> = {
    invoice_no: { kind: 'control' },
    amount: { kind: 'control' },
    status: { kind: 'control' },
  };
  if (options.existingRecordAction) {
    formInputs.existing = { kind: 'record', collection: 'invoices', recordId: 'existing' };
  }
  const actions: unknown[] = [{
    id: 'create_invoice', title: 'Add invoice', description: 'Create an invoice from form fields.',
    roles: options.roles ?? ['owner', 'participant'], parameters,
    conditions: [], effects, creates: [{ collection: 'invoices', values: createValues }],
    requireTurn: options.requireTurn ?? false, advanceTurn: false,
  }, {
    id: 'add_sample', title: 'Add sample', description: 'Add one sample invoice.',
    roles: ['owner'], parameters: [], conditions: [], effects: [],
    creates: [{ collection: 'invoices', values: {
      invoice_no: { literal: 'INV-200' }, amount: { literal: 250 }, status: { literal: 'draft' }, paid: { literal: false },
    } }],
    requireTurn: false, advanceTurn: false,
  }];
  const program = {
    version: 1,
    title: 'Invoices',
    description: 'Track invoices and payment status.',
    collections: [{ id: 'invoices', title: 'Invoices', fields: [
      { id: 'invoice_no', label: 'Invoice number', type: 'text', required: true, choices: ['INV-100', 'INV-200'] },
      { id: 'amount', label: 'Amount', type: 'number', required: true, min: 0, max: 5000 },
      { id: 'status', label: 'Status', type: 'text', required: true, choices: ['draft', 'paid'] },
      { id: 'paid', label: 'Paid', type: 'boolean', required: true },
    ] }],
    actions,
    invariants: options.uniqueInvoiceNumber ? [{ id: 'invoice_no_unique', collection: 'invoices', fields: ['invoice_no'], message: 'Invoice number must be unique.' }] : [],
    turnOrder: options.turnOrder ?? [], evidence: [], assumptions: ['Invoices are entered by a room member.'],
    canvas: { version: 1, views: [{ id: 'invoice_controls', kind: 'controls', title: 'Invoice entry', controls: [
      { id: 'invoice_form', kind: 'form', label: 'Add invoice', actionId: 'create_invoice', inputs: formInputs },
      { id: 'sample_button', kind: 'button', label: 'Add sample', actionId: 'add_sample', inputs: {} },
    ] }] },
  };
  return {
    kind: 'table', program,
    initialRecords: options.initialRecords ?? { invoices: [] },
  };
}

function actorContext(options: {
  role?: ActorContext['role'];
  seat?: ActorContext['seat'];
  hash?: ActorContext['hash'];
} = {}): ActorContext {
  return {
    actorId: 'actor-1', name: 'Room owner', role: options.role ?? 'owner', ...(options.seat ? { seat: options.seat } : {}),
    workspaceId: 'workspace-1', epoch: 1, now: 1_800_000_000_000,
    hash: options.hash ?? (value => createHash('sha256').update(JSON.stringify(value)).digest('hex')),
  };
}

const invoiceInputs = { invoice_no: 'INV-100', amount: 1200, status: 'draft' };

describe('typed table record creation', () => {
  it('creates a row through a generated form and supports a no-input sample button', () => {
    const change = parseBoundedTableChange(invoiceChange());
    const active = applyTableChange(createTableState(), change);
    expect(active.records.invoices).toEqual([]);
    expect(active.program?.canvas?.views[0]).toMatchObject({
      kind: 'controls', controls: [
        { kind: 'form', actionId: 'create_invoice' },
        { kind: 'button', actionId: 'add_sample', inputs: {} },
      ],
    });

    const formResult = handleTableCommand(active, 'table.act', { actionId: 'create_invoice', inputs: invoiceInputs }, actorContext());
    expect(formResult?.state.records.invoices).toHaveLength(1);
    expect(formResult?.state.records.invoices[0]).toMatchObject({
      id: expect.stringMatching(/^record_[0-9]+_[0-9]{2}_[a-z0-9_-]{1,12}$/),
      values: { invoice_no: 'INV-100', amount: 1200, status: 'draft', paid: false },
    });
    const repeated = handleTableCommand(active, 'table.act', { actionId: 'create_invoice', inputs: invoiceInputs }, actorContext());
    expect(repeated?.state.records.invoices[0].id).toBe(formResult?.state.records.invoices[0].id);
    const nextRevision = handleTableCommand(formResult!.state, 'table.act', {
      actionId: 'create_invoice', inputs: { ...invoiceInputs, invoice_no: 'INV-200' },
    }, actorContext());
    expect(nextRevision?.state.records.invoices[1].id).not.toBe(formResult?.state.records.invoices[0].id);

    const sampleResult = handleTableCommand(formResult!.state, 'table.act', { actionId: 'add_sample', inputs: {} }, actorContext());
    expect(sampleResult?.state.records.invoices).toHaveLength(2);
    expect(sampleResult?.state.records.invoices[1].values).toEqual({ invoice_no: 'INV-200', amount: 250, status: 'draft', paid: false });
  });

  it('checks create operand types and required, choice, and numeric bounds at runtime', () => {
    expect(() => applyTableChange(createTableState(), parseBoundedTableChange(invoiceChange({ invalidAmountOperand: true }))))
      .toThrow(/create|value|field/i);
    expect(() => applyTableChange(createTableState(), parseBoundedTableChange(invoiceChange({ missingPaidCreateValue: true }))))
      .toThrow(/Paid.*create value or a default/i);

    const active = applyTableChange(createTableState(), parseBoundedTableChange(invoiceChange()));
    expect(() => handleTableCommand(active, 'table.act', { actionId: 'create_invoice', inputs: { amount: 1200, status: 'draft' } }, actorContext()))
      .toThrow(/required|inputs/i);
    expect(() => handleTableCommand(active, 'table.act', { actionId: 'create_invoice', inputs: { ...invoiceInputs, status: 'void' } }, actorContext()))
      .toThrow(/invalid/i);
    expect(() => handleTableCommand(active, 'table.act', { actionId: 'create_invoice', inputs: { ...invoiceInputs, amount: 5001 } }, actorContext()))
      .toThrow(/invalid/i);
  });

  it('denies record creation outside the declared role or current turn', () => {
    const change = parseBoundedTableChange(invoiceChange({ roles: ['owner'], requireTurn: true, turnOrder: ['host', 'member-1'] }));
    const active = applyTableChange(createTableState(), change);
    expect(() => handleTableCommand(active, 'table.act', { actionId: 'create_invoice', inputs: invoiceInputs }, actorContext({ role: 'participant', seat: 'member-1' })))
      .toThrow(/role|cannot perform/i);
    expect(() => handleTableCommand(active, 'table.act', { actionId: 'create_invoice', inputs: invoiceInputs }, actorContext({ seat: 'member-1' })))
      .toThrow(/turn/i);
  });

  it('rolls back an update when a created row violates an invariant', () => {
    const change = parseBoundedTableChange(invoiceChange({
      existingRecordAction: true,
      uniqueInvoiceNumber: true,
      initialRecords: { invoices: [{ id: 'existing', values: { invoice_no: 'INV-100', amount: 800, status: 'paid', paid: false } }] },
    }));
    const active = applyTableChange(createTableState(), change);
    const before = structuredClone(active);
    expect(() => handleTableCommand(active, 'table.act', {
      actionId: 'create_invoice', inputs: { existing: 'existing', ...invoiceInputs },
    }, actorContext())).toThrow('Invoice number must be unique.');
    expect(active).toEqual(before);
  });

  it('rejects a generated record id collision without changing the prior state', () => {
    const context = actorContext({ hash: () => 'a'.repeat(64) });
    const generatedId = `record_1_00_${'a'.repeat(12)}`;
    const active = applyTableChange(createTableState(), parseBoundedTableChange(invoiceChange({
      initialRecords: { invoices: [{ id: generatedId, values: { invoice_no: 'INV-200', amount: 250, status: 'draft', paid: false } }] },
    })));
    const before = structuredClone(active);
    expect(() => handleTableCommand(active, 'table.act', { actionId: 'create_invoice', inputs: invoiceInputs }, context))
      .toThrow(/collision|identifier/i);
    expect(active).toEqual(before);
  });

  it('preserves rows while adding an empty collection and a required field with a validated default', () => {
    const original = parseBoundedTableChange(invoiceChange({
      initialRecords: { invoices: [{ id: 'existing', values: { invoice_no: 'INV-100', amount: 800, status: 'paid', paid: true } }] },
    }));
    const active = applyTableChange(createTableState(), original);
    const program = structuredClone(active.program!);
    const invoiceCollection = program.collections.find(collection => collection.id === 'invoices')!;
    const evolvedProgram: TableProgram = {
      ...program,
      collections: [
        { ...invoiceCollection, fields: [...invoiceCollection.fields, { id: 'source', label: 'Entry source', type: 'text', required: true, choices: ['manual', 'import'], default: 'manual' }] },
        { id: 'approvals', title: 'Approvals', fields: [{ id: 'approver', label: 'Approver', type: 'text', required: true }] },
      ],
    };
    const evolved = parseBoundedTableChange({ kind: 'table', program: evolvedProgram, initialRecords: {} });
    const next = applyTableChange(active, evolved);
    expect(next.records.invoices).toEqual([{ id: 'existing', values: { invoice_no: 'INV-100', amount: 800, status: 'paid', paid: true, source: 'manual' } }]);
    expect(next.records.approvals).toEqual([]);
    const createdWithDefault = handleTableCommand(next, 'table.act', { actionId: 'create_invoice', inputs: invoiceInputs }, actorContext())?.state;
    expect(createdWithDefault?.records.invoices[1].values.source).toBe('manual');

    expect(() => applyTableChange(active, parseBoundedTableChange({
      kind: 'table', program: evolvedProgram, initialRecords: { invoices: [] },
    }))).toThrow(/initialRecords|preserve/i);

    const invalidDefaultProgram = structuredClone(evolvedProgram);
    invalidDefaultProgram.collections[0].fields.at(-1)!.default = 'unlisted';
    expect(() => applyTableChange(active, parseBoundedTableChange({
      kind: 'table', program: invalidDefaultProgram, initialRecords: {},
    }))).toThrow(/default|value|choice/i);
  });

  it('rejects removing or changing an existing field and dropping an invariant', () => {
    const original = parseBoundedTableChange(invoiceChange({
      uniqueInvoiceNumber: true,
      initialRecords: { invoices: [{ id: 'existing', values: { invoice_no: 'INV-100', amount: 800, status: 'paid', paid: true } }] },
    }));
    const active = applyTableChange(createTableState(), original);
    const program = structuredClone(active.program!);
    const removePaidProgram = structuredClone(program);
    removePaidProgram.collections[0].fields = removePaidProgram.collections[0].fields.filter(field => field.id !== 'paid');
    removePaidProgram.actions = removePaidProgram.actions.map(action => ({
      ...action,
      creates: action.creates?.map(create => ({
        ...create,
        values: Object.fromEntries(Object.entries(create.values).filter(([field]) => field !== 'paid')),
      })),
    }));
    expect(() => applyTableChange(active, parseBoundedTableChange({
      kind: 'table', program: removePaidProgram, initialRecords: {},
    }))).toThrow(/retain|current field/i);

    const changeTypeProgram = structuredClone(program);
    changeTypeProgram.collections[0].fields.find(field => field.id === 'paid')!.type = 'text';
    changeTypeProgram.actions = changeTypeProgram.actions.map(action => ({
      ...action,
      creates: action.creates?.map(create => ({ ...create, values: { ...create.values, paid: { literal: 'no' } } })),
    }));
    expect(() => applyTableChange(active, parseBoundedTableChange({
      kind: 'table', program: changeTypeProgram, initialRecords: {},
    }))).toThrow(/retain|current field/i);

    const dropInvariantProgram = { ...program, invariants: [] };
    expect(() => applyTableChange(active, parseBoundedTableChange({
      kind: 'table', program: dropInvariantProgram, initialRecords: {},
    }))).toThrow(/retain|invariant/i);
  });
});
