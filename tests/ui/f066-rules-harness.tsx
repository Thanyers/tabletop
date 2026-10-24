import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createTableState } from '../../src/tabletop/domain/table';
import type { WorkspaceView } from '../../src/tabletop/shared/contracts';
import type { ComputeModule } from '../../src/tabletop/shared/table-compute';
import type { ComputedColumn, TableProgram, TableState } from '../../src/tabletop/shared/table-contracts';
import type { PlanNode } from '../../src/tabletop/runtime';
import { TableCanvasObject } from '../../src/tabletop/ui/TableCanvasObjects';
import { TableChat } from '../../src/tabletop/ui/TableChat';
import { chatReferencePrompt, matchCanvasObjects, onChatCardReference, registerCanvasObjectFinder, type ChatCardReference } from '../../src/tabletop/ui/canvas-object-finder';
import '../../src/tabletop/ui/tabletop-tokens.css';
import '../../src/tabletop/ui/tabletop.css';
import '../../src/tabletop/ui/calm-workspace.css';
import '../../src/tabletop/ui/table-chat.css';

const owner = { actorId: 'owner-1', name: 'Morgan', role: 'owner' as const, seat: 'host' };
const member = { actorId: 'member-1', name: 'Alex', role: 'participant' as const, seat: 'member-1' };
const module: ComputeModule = {
  id: 'count_orders',
  name: 'Count orders',
  description: 'Counts each order and makes a short summary for the summary table.',
  runtime: 'python',
  runtimeProfile: 'tabletop-compute-1',
  version: 1,
  source: 'def run(inputs):\n    orders = inputs["orders"].value\n    return {"count": len(orders.rows), "summary": {"columns": [{"id": "item", "label": "Item", "type": "text"}, {"id": "quantity", "label": "Quantity", "type": "number"}], "rows": []}}',
  inputs: [
    { id: 'orders', label: 'Orders', type: 'table', binding: { kind: 'collection', collectionId: 'orders' } },
    { id: 'notes', label: 'Order notes', type: 'text', binding: { kind: 'source', sourceId: 'source-orders' } },
  ],
  outputs: [
    { id: 'count', label: 'Order count', type: 'number' },
    { id: 'summary', label: 'Order summary', type: 'table', collectionId: 'summary', columns: [{ id: 'item', label: 'Item', type: 'text' }, { id: 'quantity', label: 'Quantity', type: 'number' }] },
  ],
};

const ruleOwnedColumn: ComputedColumn = {
  id: 'double_quantity', collection: 'orders', label: 'Double quantity',
  expression: { op: 'multiply', left: { op: 'field', field: 'quantity' }, right: { op: 'literal', value: 2 } },
};
const legacyOrdersColumn: ComputedColumn = {
  id: 'calc1', collection: 'orders', label: 'Legacy extra',
  expression: { op: 'add', left: { op: 'field', field: 'quantity' }, right: { op: 'literal', value: 1 } },
};
const legacySummaryColumn: ComputedColumn = {
  id: 'summary_calc1', collection: 'summary', label: 'Legacy summary extra',
  expression: { op: 'add', left: { op: 'field', field: 'quantity' }, right: { op: 'literal', value: 5 } },
};

const program: TableProgram = {
  version: 1,
  title: 'Weekend market',
  description: 'Keep orders clear and easy to track.',
  collections: [
    { id: 'orders', title: 'Orders', fields: [
      { id: 'item', label: 'Item', type: 'text', required: true },
      { id: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
      { id: 'paid', label: 'Paid', type: 'boolean', required: true },
    ] },
    { id: 'summary', title: 'Order summary', fields: [
      { id: 'item', label: 'Item', type: 'text', required: true },
      { id: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1 },
    ] },
  ],
  actions: [{
    id: 'mark_paid', title: 'Mark an order as paid', description: 'Records when money has arrived.', roles: ['owner', 'participant'],
    parameters: [{ id: 'order', label: 'Order', type: 'record', collection: 'orders' }],
    conditions: [], effects: [{ record: 'order', field: 'paid', op: 'set', value: { literal: true } }], requireTurn: false, advanceTurn: false,
  }],
  invariants: [{ id: 'unique_item', collection: 'orders', fields: ['item'], message: 'Each order needs a name.' }],
  turnOrder: [], evidence: [], assumptions: [], computedColumns: [ruleOwnedColumn], compute: { version: 1, modules: [module] },
  canvas: { version: 1, views: [{
    id: 'fixed_order_actions', kind: 'controls', title: 'Order actions', controls: [
      { id: 'tea_action', kind: 'button', label: 'Mark Tea paid', actionId: 'mark_paid', inputs: { order: { kind: 'record', collection: 'orders', recordId: 'order-1' } } },
      { id: 'bread_action', kind: 'button', label: 'Mark Bread paid', actionId: 'mark_paid', inputs: { order: { kind: 'record', collection: 'orders', recordId: 'order-2' } } },
    ],
  }] },
};

const initialState: TableState = {
  ...createTableState(),
  dataRevision: 8,
  ruleRevision: 4,
  program,
  computedColumns: [ruleOwnedColumn, legacyOrdersColumn, legacySummaryColumn],
  sources: [{ id: 'source-orders', filename: 'order-notes.csv', text: 'item,quantity\nTea,5', sha256: 'fixture-hash', createdAt: Date.now() - 600_000 }],
  records: { orders: [
    { id: 'order-1', values: { item: 'Tea', quantity: 5, paid: false } },
    { id: 'order-2', values: { item: 'Bread', quantity: 3, paid: true } },
  ], summary: [] },
  computeRuns: [{
    runId: '00000000-0000-4000-8000-000000000066', moduleId: module.id, moduleVersion: module.version,
    runtimeProfile: 'tabletop-compute-1', actorId: member.actorId, role: 'participant', seat: member.seat,
    status: 'succeeded', startedAt: Date.now() - 240_000, completedAt: Date.now() - 180_000,
    dataRevision: 8, ruleRevision: 4, sourceIds: ['source-orders'],
    outputs: [
      { outputId: 'count', value: 2 },
      { outputId: 'summary', value: { columns: [{ id: 'item', label: 'Item', type: 'text' }, { id: 'quantity', label: 'Quantity', type: 'number' }], rows: [{ item: 'Tea', quantity: 5 }, { item: 'Bread', quantity: 3 }] } },
    ],
  }],
  dataProvenance: {
    sources: { 'source-orders': { actorId: member.actorId, at: Date.now() - 600_000, origin: 'human' } },
    collections: { orders: { actorId: member.actorId, at: Date.now() - 300_000, origin: 'human' } },
  },
  access: { roles: [], assignments: { [member.actorId]: 'viewer' } },
};

function makeView(actor: typeof owner | typeof member, domain: TableState): WorkspaceView {
  return {
    id: 'f066-ui-fixture', title: program.title, kind: 'table', epoch: 1, revision: `r${domain.dataRevision}.${domain.ruleRevision}`,
    actor, members: [owner, member], domain, createdAt: Date.now() - 3_600_000, expiresAt: Date.now() + 3_600_000,
  };
}

const rulesNode: PlanNode = { id: 'table.rules', capability: 'TableRulesV1', title: 'Rules', position: { x: 0, y: 0 }, inputs: {}, visibility: 'shared', version: 1 };
const ordersNode: PlanNode = { id: 'table.collection.orders', capability: 'TableRowsV1', title: 'Orders', position: { x: 0, y: 0 }, inputs: {}, visibility: 'shared', version: 1 };
const summaryNode: PlanNode = { id: 'table.collection.summary', capability: 'TableRowsV1', title: 'Order summary', position: { x: 0, y: 0 }, inputs: {}, visibility: 'shared', version: 1 };

declare global {
  interface Window {
    __f066Commands?: Array<{ type: string; payload: unknown }>;
    __f066SentMessages?: string[];
    __f066OpenedObjects?: string[];
    __f066PendingPrefill?: string;
    __f066ReleasePrefill?: () => void;
  }
}

function Harness() {
  const [actor, setActor] = useState<typeof owner | typeof member>(owner);
  const [references, setReferences] = useState<ChatCardReference[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; key: number }>();
  const [focusKey, setFocusKey] = useState(0);
  const [outgoingPrompt, setOutgoingPrompt] = useState('');
  const [lastEdit, setLastEdit] = useState('');
  const view = makeView(actor, initialState);
  const holdJavaScriptPrefill = new URLSearchParams(window.location.search).get('f066-prefill-race') === 'hold';

  useEffect(() => registerCanvasObjectFinder((_verb, query) => {
    const match = matchCanvasObjects([{ id: 'table.rules', title: 'Rules' }], query)[0];
    if (!match) return { handled: false };
    (window.__f066OpenedObjects ??= []).push(match.id);
    return { handled: true, message: `Opened “${match.title}”.` };
  }), []);

  useEffect(() => onChatCardReference((reference) => {
    setReferences((current) => current.some((item) => item.id === reference.id) ? current : [...current, reference].slice(-5));
    setFocusKey((current) => current + 1);
  }), []);

  const onCommand = async (type: string, payload: unknown) => {
    (window.__f066Commands ??= []).push({ type, payload });
    return null;
  };
  const onEditRules = (prompt = '') => {
    setLastEdit(prompt);
    setEditMode(true);
    const nextPrefill = { text: prompt, key: Date.now() };
    if (holdJavaScriptPrefill && prompt.startsWith('Change Count orders to use JavaScript.')) {
      window.__f066PendingPrefill = prompt;
      window.__f066ReleasePrefill = () => {
        setPrefill(nextPrefill);
        delete window.__f066PendingPrefill;
        delete window.__f066ReleasePrefill;
      };
    } else {
      setPrefill(nextPrefill);
    }
    setFocusKey((current) => current + 1);
  };
  const outgoing = chatReferencePrompt(references, outgoingPrompt);

  return <div className="tt-app tt-f066-harness" data-workspace-kind="table">
    <header className="tt-f066-harness__header">
      <div><h1>Weekend market</h1><p>Manage orders and shared table rules.</p></div>
      <button type="button" data-testid="toggle-role" onClick={() => { setActor((current) => current.role === 'owner' ? member : owner); setEditMode(false); setPrefill(undefined); }}>Viewing as {actor.name} · {actor.role === 'owner' ? 'Editor' : 'Viewer'}</button>
    </header>
    <main className="tt-f066-harness__main">
      <section className="tt-f066-harness__card" aria-label="Table rules card">
        <TableCanvasObject view={view} node={rulesNode} busy={null} onCommand={onCommand} outputs={{}} expanded onEditRules={onEditRules} />
      </section>
      <div className="tt-f066-harness__column">
        <section className="tt-f066-harness__card" aria-label="Orders table card">
          <h2>Editable source table</h2>
          <TableCanvasObject view={view} node={ordersNode} busy={null} onCommand={onCommand} outputs={{}} expanded />
        </section>
        <section className="tt-f066-harness__card" aria-label="Calculated summary table card">
          <h2>Calculation-linked table</h2>
          <TableCanvasObject view={view} node={summaryNode} busy={null} onCommand={onCommand} outputs={{}} expanded />
        </section>
        <section className="tt-f066-harness__card" aria-label="Table chat">
          <h2 className="tt-f066-harness__chat-title">Table chat</h2>
          <p className="tt-f066-harness__chat-note">Choose Ask or Change this rule on the Rules card. The selected rule appears above the message box.</p>
        </section>
      </div>
    </main>
    <TableChat
      workspaceId={view.id} epoch={view.epoch} actorId={actor.actorId} mode={editMode ? 'draft' : 'ask'}
      sourceFiles={view.domain.kind === 'table' ? view.domain.sources.map(({ id, filename }) => ({ id, filename })) : []}
      placeholder="Ask about this table…" aiEnabled canAttach={false} busy={false} explicitRuleEdit={editMode}
      focusKey={focusKey} prefill={prefill} onCancelRuleEdit={() => setEditMode(false)}
      onAttach={async () => undefined}
      onSend={async (message) => {
        const prompt = chatReferencePrompt(references, message);
        (window.__f066SentMessages ??= []).push(prompt);
        setOutgoingPrompt(prompt);
        return false;
      }}
      onMessageChange={setOutgoingPrompt}
      cardReferences={references}
      onRemoveCardReference={(id) => setReferences((current) => current.filter((reference) => reference.id !== id))}
      onClearCardReferences={() => setReferences([])}
    />
    <output className="tt-f066-harness__sent-prompt" data-testid="wire-prompt" aria-hidden="true">{outgoing}</output>
    <output className="tt-f066-harness__sent-prompt" data-testid="last-edit" aria-hidden="true">{lastEdit}</output>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Harness />);
