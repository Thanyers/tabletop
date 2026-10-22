import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decideDomain, projectDomain } from './index';
import { createTableState, handleTableCommand } from './table';
import { MAX_CARD_META_BYTES, MAX_CARD_META_ENTRIES, canvasCardSignature, diffCardMeta, pruneCardMeta, resolveCardMeta } from './table-card-meta';
import { equipmentChange, tableScenarioSources } from '../testing/table-scenarios';
import type { ActorContext, DomainState, WorkspaceView } from '../shared/contracts';
import type { GenerativeViewDescriptor, MetricViewDescriptor } from '../shared/generative-contracts';
import type { CanvasCardMeta, TableAction, TableChange, TableProgram, TableRecord, TableState } from '../shared/table-contracts';

// F052: per-card timestamps and provenance. Every time here is a fixed `ctx.now`, so the tests are
// deterministic: the activation, removal and file commands are the only writes, never a simulation.

function actor(now: number, overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    actorId: 'account-owner', name: 'Owner', role: 'owner', workspaceId: 'workspace-f052', epoch: 1, now,
    hash: (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'),
    ...overrides,
  };
}
const member: ActorContext = actor(6000, { actorId: 'account-member', name: 'Member', role: 'participant', seat: 'member-1' });

function workspaceView(state: TableState, createdAt = 100): WorkspaceView {
  return {
    id: 'workspace-f052', title: 'Table', kind: 'table', epoch: 1, revision: 'opaque',
    actor: { actorId: 'account-owner', name: 'Owner', role: 'owner' }, members: [],
    domain: state, createdAt, expiresAt: 1_000_000,
  };
}

function inventoryAction(id: string, sku: string): TableAction {
  return {
    id, title: id, description: `${id} description`, roles: ['owner'],
    parameters: [], conditions: [], effects: [],
    creates: [{ collection: 'items', values: { sku: { literal: sku } } }],
    requireTurn: false, advanceTurn: false,
  };
}

/** One small valid program; `records` is empty after the first activation, as a rule edit requires. */
function inventoryChange(options: { views?: GenerativeViewDescriptor[]; description?: string; records?: Record<string, TableRecord[]> } = {}): TableChange {
  const views = options.views ?? [];
  const program: TableProgram = {
    version: 1, title: 'Inventory', description: options.description ?? 'Items on the shelf.',
    collections: [{ id: 'items', title: 'Items', fields: [{ id: 'sku', label: 'SKU', type: 'text', required: true }] }],
    actions: [inventoryAction('add_item', 'sample'), inventoryAction('add_extra', 'extra')],
    invariants: [], turnOrder: ['host'], evidence: [], assumptions: [],
    ...(views.length > 0 ? { canvas: { version: 1, views } } : {}),
  };
  return { kind: 'table', program, initialRecords: options.records ?? { items: [] } };
}

const metric = (id: string, title: string): MetricViewDescriptor => ({ id, kind: 'metric', title, value: { op: 'literal', value: 1 } });

const REVIEW_STEPS = ['evolve.propose', 'evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate'] as const;

function activate(state: TableState, change: TableChange, ctx: ActorContext): TableState {
  let domain: DomainState = state;
  for (const type of REVIEW_STEPS) {
    domain = decideDomain(domain, { type, payload: type === 'evolve.propose' ? { change } : {} }, ctx).state;
  }
  if (domain.kind !== 'table') throw new Error('Expected a table domain.');
  return domain;
}

function command(state: TableState, type: string, payload: unknown, ctx: ActorContext): TableState {
  const decision = handleTableCommand(state, type, payload, ctx);
  if (!decision) throw new Error(`Expected ${type} to produce a decision.`);
  return decision.state;
}

describe('canvas card meta (F052)', () => {
  it('records the first activation for rules, actions, collections and views', () => {
    const active = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items')] }), actor(5000));
    expect(active.ruleRevision).toBe(1);
    const meta = active.cardMeta ?? {};
    expect(Object.keys(meta).sort()).toEqual([
      'table.actions', 'table.canvas', 'table.collection.items', 'table.rules', 'table.view.total_items',
    ]);
    for (const cardId of Object.keys(meta)) {
      expect(meta[cardId], cardId).toEqual({
        createdAt: 5000, updatedAt: 5000, createdBy: 'account-owner', updatedBy: 'account-owner',
        origin: 'ai', revision: 1, source: 'recorded',
      });
    }
  });

  it('leaves timestamps out of simulate, validate and approve', () => {
    let domain: DomainState = createTableState();
    for (const type of ['evolve.propose', 'evolve.simulate', 'evolve.validate', 'evolve.approve'] as const) {
      domain = decideDomain(domain, { type, payload: type === 'evolve.propose' ? { change: inventoryChange() } : {} }, actor(5000)).state;
    }
    if (domain.kind !== 'table') throw new Error('Expected a table domain.');
    expect(domain.cardMeta).toBeUndefined();
  });

  it('does not bump a view that a later activation keeps unchanged (F018 preserve)', () => {
    const first = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items')] }), actor(5000));
    const second = activate(first, inventoryChange({ description: 'Items on the shelf, revised.', records: {} }), actor(7000));
    expect(second.program?.canvas?.views.map((view) => view.id)).toEqual(['total_items']);
    expect(second.cardMeta?.['table.view.total_items']).toEqual(first.cardMeta?.['table.view.total_items']);
    expect(second.cardMeta?.['table.actions']).toEqual(first.cardMeta?.['table.actions']);
    expect(second.cardMeta?.['table.collection.items']).toEqual(first.cardMeta?.['table.collection.items']);
    expect(second.cardMeta?.['table.rules']).toMatchObject({ createdAt: 5000, updatedAt: 7000, updatedBy: 'account-owner', revision: 2 });
  });

  it('bumps only the view whose descriptor changed', () => {
    const first = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items'), metric('count_items', 'Count')] }), actor(5000));
    const second = activate(first, inventoryChange({
      views: [metric('total_items', 'Total items'), metric('count_items', 'Count, renamed')], records: {},
    }), actor(7000));
    expect(second.cardMeta?.['table.view.count_items']).toMatchObject({ createdAt: 5000, updatedAt: 7000, revision: 2 });
    expect(second.cardMeta?.['table.view.total_items']).toEqual(first.cardMeta?.['table.view.total_items']);
    expect(second.cardMeta?.['table.rules']).toEqual(first.cardMeta?.['table.rules']);
    expect(second.cardMeta?.['table.canvas']).toEqual(first.cardMeta?.['table.canvas']);
  });

  it('does not bump cards for record or row changes', () => {
    const active = activate(createTableState(), inventoryChange(), actor(5000));
    const acted = command(active, 'table.act', { actionId: 'add_item', inputs: {} }, actor(9000));
    expect(acted.dataRevision).toBe(active.dataRevision + 1);
    expect(acted.records.items).toHaveLength(1);
    expect(acted.cardMeta).toEqual(active.cardMeta);
  });

  it('does not bump cards for layout or trash changes', () => {
    const active = activate(createTableState(), inventoryChange(), actor(5000));
    const moved = decideDomain(active, {
      type: 'canvas.layout',
      payload: { expectedLayoutRevision: 0, positions: { 'table.rules': { x: 10, y: 20 }, 'table.actions': { x: 30, y: 40 } } },
    }, actor(9000)).state;
    if (moved.kind !== 'table') throw new Error('Expected a table domain.');
    expect(moved.canvasLayout?.revision).toBe(1);
    expect(moved.cardMeta).toEqual(active.cardMeta);
  });

  it('drops the removed view card and touches the rules card on removeItem', () => {
    const active = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items'), metric('count_items', 'Count')] }), actor(5000));
    const removed = decideDomain(active, { type: 'evolve.removeItem', payload: { kind: 'view', id: 'total_items' } }, actor(8000)).state;
    if (removed.kind !== 'table') throw new Error('Expected a table domain.');
    expect(removed.cardMeta?.['table.view.total_items']).toBeUndefined();
    expect(removed.cardMeta?.['table.view.count_items']).toEqual(active.cardMeta?.['table.view.count_items']);
    expect(removed.cardMeta?.['table.rules']).toMatchObject({ createdAt: 5000, updatedAt: 8000, updatedBy: 'account-owner', revision: 2 });
    expect(removed.cardMeta?.['table.actions']).toEqual(active.cardMeta?.['table.actions']);
  });

  it('touches the actions card when an action is removed', () => {
    const active = activate(createTableState(), inventoryChange(), actor(5000));
    const removed = decideDomain(active, { type: 'evolve.removeItem', payload: { kind: 'action', id: 'add_item' } }, actor(8000)).state;
    if (removed.kind !== 'table') throw new Error('Expected a table domain.');
    expect(removed.cardMeta?.['table.actions']).toMatchObject({ createdAt: 5000, updatedAt: 8000, updatedBy: 'account-owner', revision: 2 });
    expect(removed.cardMeta?.['table.rules']).toMatchObject({ createdAt: 5000, updatedAt: 8000 });
    expect(removed.cardMeta?.['table.collection.items']).toEqual(active.cardMeta?.['table.collection.items']);
  });

  it('stamps the files card as a human change on add and remove', () => {
    const imported = command(createTableState(), 'table.import', tableScenarioSources.equipment, actor(5000));
    expect(imported.cardMeta?.['table.sources']).toEqual({
      createdAt: 5000, updatedAt: 5000, createdBy: 'account-owner', updatedBy: 'account-owner', origin: 'human', source: 'recorded',
    });
    const second = command(imported, 'table.import', tableScenarioSources.game, actor(6000));
    expect(second.cardMeta?.['table.sources']).toMatchObject({ createdAt: 5000, updatedAt: 6000 });
    const removed = command(second, 'table.removeSource', { sourceId: second.sources[1]!.id }, actor(7000));
    expect(removed.cardMeta?.['table.sources']).toMatchObject({ createdAt: 5000, updatedAt: 7000, origin: 'human', updatedBy: 'account-owner' });
    const cleared = command(removed, 'table.removeSource', { sourceId: removed.sources[0]!.id }, actor(8000));
    expect(cleared.cardMeta?.['table.sources']).toBeUndefined();
  });

  it('keeps files and other non-program card meta through an activation', () => {
    const imported = command(createTableState(), 'table.import', tableScenarioSources.equipment, actor(4000));
    const active = activate(imported, equipmentChange(imported.sources[0]!.id), actor(5000));
    expect(active.cardMeta?.['table.sources']).toEqual(imported.cardMeta?.['table.sources']);
    expect(active.cardMeta?.['table.collection.equipment']).toMatchObject({ createdAt: 5000, origin: 'ai', revision: 1 });
  });

  it('keeps note times in the note and resolves them without storing a copy', () => {
    const added = command(createTableState(), 'table.addNote', { text: 'Keep me', x: 0, y: 0 }, actor(5000));
    const note = (added.notes ?? [])[0];
    if (!note) throw new Error('Expected one note.');
    const cardId = `table.note.${note.id}`;
    const moved = command(added, 'table.moveNote', { noteId: note.id, x: 40, y: 40 }, actor(9000));
    expect(moved.cardMeta?.[cardId]).toBeUndefined();
    expect(resolveCardMeta(moved, workspaceView(moved), cardId)).toEqual({ createdAt: 5000, updatedAt: 5000, createdBy: 'account-owner', origin: 'human', source: 'recorded' });
    const edited = command(added, 'table.updateNote', { noteId: note.id, text: 'Keep me edited' }, actor(7000));
    expect(resolveCardMeta(edited, workspaceView(edited), cardId)).toMatchObject({ createdAt: 5000, updatedAt: 7000, updatedBy: 'account-owner', origin: 'human', source: 'recorded' });
  });

  it('caps card meta at 48 entries, dropping the oldest update', () => {
    expect([MAX_CARD_META_ENTRIES, MAX_CARD_META_BYTES]).toEqual([48, 12 * 1024]);
    const meta: Record<string, CanvasCardMeta> = {};
    const live: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const cardId = `table.collection.c${String(index).padStart(2, '0')}`;
      live.push(cardId);
      meta[cardId] = { createdAt: 1000 + index, updatedAt: 1000 + index, createdBy: 'account-owner', updatedBy: 'account-owner', origin: 'ai', revision: 1, source: 'recorded' };
    }
    const pruned = pruneCardMeta(meta, live);
    expect(Object.keys(pruned)).toHaveLength(MAX_CARD_META_ENTRIES);
    expect(pruned['table.collection.c00']).toBeUndefined();
    expect(pruned['table.collection.c59']).toBeDefined();
  });

  it('caps serialized card meta at 12 KiB', () => {
    const longActorId = 'a'.repeat(150);
    const meta: Record<string, CanvasCardMeta> = {};
    const live: string[] = [];
    const suffix = 'x'.repeat(10);
    for (let index = 0; index < MAX_CARD_META_ENTRIES; index += 1) {
      const cardId = `table.collection.${suffix}${String(index).padStart(2, '0')}`;
      live.push(cardId);
      meta[cardId] = { createdAt: index, updatedAt: index, createdBy: longActorId, updatedBy: longActorId, origin: 'ai', revision: 1, source: 'recorded' };
    }
    expect(new TextEncoder().encode(JSON.stringify(meta)).byteLength).toBeGreaterThan(MAX_CARD_META_BYTES);
    const pruned = pruneCardMeta(meta, live);
    expect(new TextEncoder().encode(JSON.stringify(pruned)).byteLength).toBeLessThanOrEqual(MAX_CARD_META_BYTES);
    expect(Object.keys(pruned).length).toBeLessThan(MAX_CARD_META_ENTRIES);
    expect(pruned[`table.collection.${suffix}47`]).toBeDefined();
    expect(pruned[`table.collection.${suffix}00`]).toBeUndefined();
  });

  it('prunes entries for cards that are no longer on the canvas', () => {
    const meta: Record<string, CanvasCardMeta> = {
      'table.rules': { createdAt: 1, updatedAt: 2, origin: 'ai', source: 'recorded' },
      'table.collection.gone': { createdAt: 1, updatedAt: 2, origin: 'ai', source: 'recorded' },
    };
    expect(pruneCardMeta(meta, ['table.rules'])).toEqual({ 'table.rules': meta['table.rules'] });
  });

  it('resolves recorded times from retained revisions when a room has no card meta', () => {
    const first = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items')] }), actor(5000));
    const second = activate(first, inventoryChange({ views: [metric('total_items', 'Total items, renamed')], records: {} }), actor(7000));
    const legacy: TableState = { ...second };
    delete legacy.cardMeta;
    const view = workspaceView(legacy);
    expect(resolveCardMeta(legacy, view, 'table.view.total_items')).toEqual({
      createdAt: 5000, updatedAt: 7000, createdBy: 'account-owner', updatedBy: 'account-owner', origin: 'ai', revision: 2, source: 'recorded',
    });
    expect(resolveCardMeta(legacy, view, 'table.rules')).toMatchObject({ createdAt: 5000, updatedAt: 5000, revision: 1, source: 'recorded' });
  });

  it('backfills a legacy room instead of stamping creation at the next activation', () => {
    const first = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items')] }), actor(5000));
    const legacy: TableState = { ...first };
    delete legacy.cardMeta;
    const next = activate(legacy, inventoryChange({
      description: 'Items on the shelf, revised.',
      views: [metric('total_items', 'Total items')],
      records: {},
    }), actor(7000));
    // The unchanged view keeps the creation inferred from revision 1, not the activation clock.
    expect(next.cardMeta?.['table.view.total_items']).toMatchObject({ createdAt: 5000, updatedAt: 5000, source: 'recorded' });
    // The rules card did change, so only its update moves.
    expect(next.cardMeta?.['table.rules']).toMatchObject({ createdAt: 5000, updatedAt: 7000, revision: 2 });
  });

  it('marks a card as inferred when the oldest retained revision is not r1', () => {
    const first = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items')] }), actor(5000));
    const second = activate(first, inventoryChange({ description: 'Revised.', records: {} }), actor(7000));
    const legacy: TableState = { ...second, revisions: second.revisions.slice(1) };
    delete legacy.cardMeta;
    expect(resolveCardMeta(legacy, workspaceView(legacy), 'table.rules')).toEqual({
      createdAt: 7000, updatedAt: 7000, createdBy: 'account-owner', updatedBy: 'account-owner', origin: 'ai', revision: 2, source: 'inferred',
    });
  });

  it('resolves files and system cards, and nothing when there is no evidence', () => {
    const imported = command(createTableState(), 'table.import', tableScenarioSources.equipment, actor(5000));
    const view = workspaceView(imported, 300);
    // A stored entry always wins over inference.
    expect(resolveCardMeta(imported, view, 'table.sources')).toMatchObject({ createdBy: 'account-owner', source: 'recorded' });
    const legacy: TableState = { ...imported };
    delete legacy.cardMeta;
    expect(resolveCardMeta(legacy, view, 'table.sources')).toEqual({ createdAt: 5000, updatedAt: 5000, origin: 'human', source: 'recorded' });
    expect(resolveCardMeta(legacy, view, 'workspace.history')).toEqual({ createdAt: 300, updatedAt: 300, origin: 'system', source: 'inferred' });
    expect(resolveCardMeta(legacy, view, 'workspace.people')).toMatchObject({ origin: 'system', source: 'inferred' });
    expect(resolveCardMeta(legacy, view, 'table.rules')).toBeUndefined();
    expect(resolveCardMeta(legacy, view, 'table.note.note_missing')).toBeUndefined();
    expect(resolveCardMeta(legacy, view, `table.chat.${'a'.repeat(64)}`)).toBeUndefined();
  });

  it('keeps card meta in the private participant projection', () => {
    const active = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items')] }), actor(5000));
    const projected = projectDomain(active, member, 'private');
    if (projected.kind !== 'table') throw new Error('Expected a table projection.');
    expect(projected.revisions).toEqual([]);
    expect(projected.cardMeta).toEqual(active.cardMeta);
    expect(projected.cardMeta?.['table.rules']).toBeDefined();
  });

  it('differs by canonical signature, so a reordered program never fakes a change', () => {
    const program = inventoryChange({ views: [metric('total_items', 'Total items')] }).program;
    const reordered: TableProgram = Object.fromEntries(Object.entries(program).reverse()) as TableProgram;
    for (const cardId of ['table.rules', 'table.actions', 'table.canvas', 'table.collection.items', 'table.view.total_items']) {
      expect(canvasCardSignature(cardId, reordered), cardId).toBe(canvasCardSignature(cardId, program));
    }
    expect(canvasCardSignature('table.view.missing', program)).toBeNull();
    expect(canvasCardSignature('table.rules', null)).toBeNull();
  });

  it('creates entries for new cards and keeps unchanged ones while diffing', () => {
    const active = activate(createTableState(), inventoryChange({ views: [metric('total_items', 'Total items')] }), actor(5000));
    const program = active.program;
    if (!program) throw new Error('Expected an active program.');
    expect(diffCardMeta(active, program, 6000, 'account-member', 2)).toEqual(active.cardMeta);
    const withoutView: TableProgram = { ...program, canvas: { version: 1, views: [] } };
    const trimmed = diffCardMeta(active, withoutView, 6000, 'account-member', 2);
    expect(trimmed['table.view.total_items']).toBeUndefined();
    expect(trimmed['table.canvas']).toMatchObject({ updatedAt: 6000, updatedBy: 'account-member', revision: 2 });
    expect(trimmed['table.collection.items']).toEqual(active.cardMeta?.['table.collection.items']);
    const grown = diffCardMeta(active, { ...program, canvas: { version: 1, views: [metric('total_items', 'Total items'), metric('extra', 'Extra')] } }, 6000, 'account-member', 2);
    expect(grown['table.view.extra']).toEqual({
      createdAt: 6000, updatedAt: 6000, createdBy: 'account-member', updatedBy: 'account-member', origin: 'ai', revision: 2, source: 'recorded',
    });
  });
});
