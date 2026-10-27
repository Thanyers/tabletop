import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  type ToolPackageDefinition,
} from '../../../src/tabletop/shared/tool-package';

/**
 * F080 / C2: a hand-written synthetic package.
 *
 * This exists to prove the host before any AI is involved: if the runtime, the bridge or the
 * sandbox is broken, this package fails and the model never has to be blamed. The interaction
 * is deliberately NOT one of the built-in canvas kinds — rooms are dragged between zones and
 * cost is read from a second table's port, so passing this test cannot come from an existing
 * renderer.
 */

const UI_SOURCE = `import { useMemo, useState } from 'react';

type Row = { id: string; values: Record<string, string | number | boolean | null> };
type Port = { portId: string; status: string; rows?: Row[]; revision: { dataRevision: number } };
type Props = { sdk: unknown; ports: Port[] };

const ZONES = ['โซนหน้า', 'โซนกลาง', 'โซนหลัง'];

export function Tool(props: Props) {
  const sdk = props.sdk as {
    intent: (id: string, inputs: Record<string, string | number | boolean>) => Promise<{ status: string; code?: string }>;
    log: (level: 'info' | 'warn' | 'error', message: string) => void;
  };
  const plan = props.ports.find((port) => port.portId === 'plan');
  const budget = props.ports.find((port) => port.portId === 'budget');
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const rooms = plan && plan.rows ? plan.rows : [];
  const prices: Record<string, number> = {};
  if (budget && budget.rows) {
    for (const row of budget.rows) {
      const room = String(row.values.room ?? '');
      prices[room] = Number(row.values.price ?? 0);
    }
  }
  const total = useMemo(() => Object.keys(placed).reduce((sum, room) => sum + (prices[room] ?? 0), 0), [placed, budget]);

  const place = (room: string, zone: string) => {
    setPlaced((current) => ({ ...current, [room]: zone }));
    setPicked(null);
  };

  const propose = async () => {
    const first = Object.keys(placed)[0];
    if (!first) {
      setNote('ยังไม่มีห้องที่จัดวาง');
      return;
    }
    const outcome = await sdk.intent('allocate', { room: first, zone: placed[first] });
    setNote(outcome.status === 'committed'
      ? 'บันทึกข้อเสนอแล้ว: ' + first + ' ไป ' + placed[first]
      : 'ถูกปฏิเสธ: ' + String(outcome.code ?? 'unknown'));
  };

  return (
    <section aria-label="ผังพื้นที่กิจกรรม" style={{ font: '14px/1.6 system-ui, sans-serif', padding: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>ผังพื้นที่กิจกรรม</h3>
      <p data-testid="source-status" style={{ margin: '0 0 8px', fontSize: 12 }}>
        ต้นทาง: {plan ? 'ผัง · rev ' + plan.revision.dataRevision : 'ไม่มีผัง'} · {budget ? 'งบ · rev ' + budget.revision.dataRevision : 'ไม่มีงบ'}
      </p>
      <ul style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
        {rooms.map((room) => {
          const name = String(room.values.room ?? room.id);
          return (
            <li key={room.id}>
              <button
                type="button"
                data-testid={'room-' + name}
                aria-pressed={picked === name}
                onPointerDown={() => setPicked(name)}\n                onClick={() => setPicked(name)}
                style={{ padding: '6px 10px', border: picked === name ? '2px solid #1f6feb' : '1px solid #9aa4ae', borderRadius: 8, background: '#fff' }}
              >
                {name + ' · ' + (prices[name] ?? 0)}
              </button>
            </li>
          );
        })}
      </ul>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {ZONES.map((zone) => {
          const inZone = Object.keys(placed).filter((room) => placed[room] === zone);
          return (
            <div
              key={zone}
              data-testid={'zone-' + zone}
              onPointerUp={() => { if (picked) place(picked, zone); }}\n              style={{ minHeight: 72, border: '1px dashed #9aa4ae', borderRadius: 8, padding: 8 }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>{zone}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {inZone.map((room) => (
                  <span key={room} data-testid={'placed-' + room} style={{ padding: '2px 8px', background: '#eef4ff', borderRadius: 999 }}>{room}</span>
                ))}
              </div>
              <button
                type="button"
                data-testid={'zone-pick-' + zone}
                onClick={() => { if (picked) place(picked, zone); }}
                style={{ marginTop: 6, fontSize: 12 }}
              >
                {'วางใน ' + zone}
              </button>
            </div>
          );
        })}
      </div>
      <p data-testid="total" style={{ margin: '10px 0 6px' }}>ต้นทุนรวม: {total}</p>
      <button type="button" data-testid="propose" onClick={propose} style={{ padding: '6px 12px', borderRadius: 8 }}>
        สร้างข้อเสนอ
      </button>
      <p data-testid="note" aria-live="polite" style={{ minHeight: 20, margin: '6px 0 0', fontSize: 12 }}>{note}</p>
    </section>
  );
}
`;

const BEHAVIOR_SOURCE = `type Inputs = Record<string, unknown>;

export function allocate(inputs: Inputs) {
  const room = String(inputs.room ?? '');
  const zone = String(inputs.zone ?? '');
  if (!room || !zone) throw new Error('room and zone are required');
  // The exported behaviour returns the change list; the isolate entry wraps it for the wire.
  return [
    { target: 'self', resource: 'placements', operation: 'create', values: { room, zone } },
  ];
}
`;

export const FIXTURE_PACKAGE: ToolPackageDefinition = {
  schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
  packageId: 'activity-layout',
  version: 1,
  title: 'ผังพื้นที่กิจกรรม',
  description: 'ลากห้องลงโซนและดูต้นทุนจากอีกโต๊ะ',
  uiEntry: 'ui/main.tsx',
  behaviorEntry: 'behavior/allocate.ts',
  files: [
    { path: 'ui/main.tsx', language: 'tsx', text: UI_SOURCE },
    { path: 'behavior/allocate.ts', language: 'ts', text: BEHAVIOR_SOURCE },
  ],
  ports: [
    { id: 'plan', label: 'ผัง', direction: 'in', kind: 'records', fields: ['room', 'area'], maxRows: 20 },
    { id: 'budget', label: 'งบประมาณ', direction: 'in', kind: 'records', fields: ['room', 'price'], maxRows: 20 },
  ],
  behaviors: [
    {
      id: 'allocate',
      label: 'บันทึกข้อเสนอ',
      entry: 'allocate',
      inputs: [
        { id: 'room', label: 'ห้อง', kind: 'text', required: true },
        { id: 'zone', label: 'โซน', kind: 'text', required: true },
      ],
      writes: [{ target: 'self', resource: 'placements', operations: ['create'], maxRows: 20 }],
    },
  ],
  imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  provenance: { origin: 'human', authorLabel: 'C2 fixture', createdAt: 1_760_000_000_000 },
};
