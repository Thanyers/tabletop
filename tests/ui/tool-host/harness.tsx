import { useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { compileToolPackage } from '../../../src/tabletop/runtime/tools/compile';
import type { ToolIntentOutcome, ToolPortSnapshot } from '../../../src/tabletop/shared/tool-protocol';
import { GeneratedToolHost, type ToolIntentRequest } from '../../../src/tabletop/ui/GeneratedToolHost';
import { FIXTURE_PACKAGE } from './fixture-package';
import { HELD_OUT_LEARNING, HELD_OUT_PLAY } from '../../../src/tabletop/testing/heldout-tools';

/**
 * F080 / C2 harness: mounts the real GeneratedToolHost with the real compiler output for a
 * hand-written package. This page is a test fixture, not product code: the `onIntent` stub
 * stands in for the authority and records what the frame asked for.
 */

/** Deterministic 64-hex stand-in for the server's SHA-256; the fixture is not security-relevant. */
function fixtureHash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const block = hash.toString(16).padStart(8, '0');
  return block.repeat(8).slice(0, 64);
}

const NONCE = 'f'.repeat(32);

interface HarnessState {
  compileOk: boolean;
  problems: string[];
  intents: ToolIntentRequest[];
  logs: { level: string; message: string }[];
  outcomes: ToolIntentOutcome[];
}

const state: HarnessState = { compileOk: false, problems: [], intents: [], logs: [], outcomes: [] };
(globalThis as unknown as { __HARNESS__: HarnessState }).__HARNESS__ = state;

const which = new URLSearchParams(location.search).get('package');
const selected = which === 'quiz-hall' ? HELD_OUT_LEARNING : which === 'boat-race' ? HELD_OUT_PLAY : FIXTURE_PACKAGE;
const heldOutPorts: ToolPortSnapshot[] = which === 'quiz-hall'
  ? [{
    portId: 'questions',
    kind: 'records',
    status: 'live',
    revision: { dataRevision: 1, ruleRevision: 1, grantVersion: 1, readAt: 1_760_000_000_000 },
    sourceLabel: 'คลังคำถาม',
    rows: [
      { id: 'q1', values: { prompt: 'ข้อใดคือสัตว์เลี้ยงลูกด้วยนม' } },
      { id: 'q2', values: { prompt: 'ข้อใดคือพืช' } },
    ],
  }]
  : which === 'boat-race'
    ? [{
      portId: 'boats',
      kind: 'records',
      status: 'live',
      revision: { dataRevision: 1, ruleRevision: 1, grantVersion: 1, readAt: 1_760_000_000_000 },
      sourceLabel: 'กระดาน',
      rows: [{ id: 'red', values: { seat: 'host', score: 0 } }, { id: 'blue', values: { seat: 'guest', score: 0 } }],
    }]
    : [];
const compiled = compileToolPackage(selected, fixtureHash);
const HOSTED_PORTS: ToolPortSnapshot[] = which === undefined ? [] : heldOutPorts;
state.compileOk = compiled.ok;
if (!compiled.ok) state.problems = compiled.problems.map(problem => `${problem.code} ${problem.path}: ${problem.message}`);

const INITIAL_PORTS: ToolPortSnapshot[] = [
  {
    portId: 'plan',
    kind: 'records',
    status: 'live',
    revision: { dataRevision: 3, ruleRevision: 1, grantVersion: 1, readAt: 1_760_000_000_000 },
    sourceLabel: 'ผังกิจกรรม',
    rows: [
      { id: 'room-a', values: { room: 'ห้องอเนกประสงค์', area: 60 } },
      { id: 'room-b', values: { room: 'ห้องประชุม', area: 24 } },
    ],
  },
  {
    portId: 'budget',
    kind: 'records',
    status: 'live',
    revision: { dataRevision: 7, ruleRevision: 2, grantVersion: 1, readAt: 1_760_000_000_000 },
    sourceLabel: 'งบประมาณและอุปกรณ์',
    rows: [
      { id: 'cost-a', values: { room: 'ห้องอเนกประสงค์', price: 4200 } },
      { id: 'cost-b', values: { room: 'ห้องประชุม', price: 1800 } },
    ],
  },
];

function Harness(): React.ReactElement {
  const [ports, setPorts] = useState<ToolPortSnapshot[]>(which === 'quiz-hall' || which === 'boat-race' ? HOSTED_PORTS : INITIAL_PORTS);
  const [instances, setInstances] = useState(0);

  const onIntent = useCallback(async (request: ToolIntentRequest): Promise<ToolIntentOutcome> => {
    state.intents.push(request);
    if (request.inputs.room === 'ห้องที่ถูกปฏิเสธ') {
      const outcome: ToolIntentOutcome = { requestId: request.requestId, behaviorId: request.behaviorId, status: 'rejected', code: 'TOOL_WRITE_OUT_OF_SCOPE' };
      state.outcomes.push(outcome);
      return outcome;
    }
    const outcome: ToolIntentOutcome = { requestId: request.requestId, behaviorId: request.behaviorId, status: 'committed', instanceRevision: state.intents.length };
    state.outcomes.push(outcome);
    return outcome;
  }, []);

  const onLog = useCallback((level: 'info' | 'warn' | 'error', message: string) => {
    state.logs.push({ level, message });
  }, []);

  const presentation = useMemo(() => ({ locale: 'th' as const, reducedMotion: true, maxRows: 20 }), []);

  const freshPorts = (): ToolPortSnapshot[] => [
    { ...INITIAL_PORTS[0]!, revision: { ...INITIAL_PORTS[0]!.revision, dataRevision: 4 } },
    {
      ...INITIAL_PORTS[1]!,
      revision: { ...INITIAL_PORTS[1]!.revision, dataRevision: 9 },
      rows: [
        { id: 'cost-a', values: { room: 'ห้องอเนกประสงค์', price: 5000 } },
        { id: 'cost-b', values: { room: 'ห้องประชุม', price: 2600 } },
      ],
    },
  ];

  return (
    <main style={{ font: '14px/1.6 system-ui, sans-serif', maxWidth: 860, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 18 }}>C2 — generated tool host</h1>
      <p data-testid="compile" style={{ fontSize: 12 }}>
        {state.compileOk ? 'compile: ok' : `compile: ${state.problems.join(' | ')}`}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" data-testid="push-ports" onClick={() => setPorts(freshPorts())}>อัปเดตข้อมูลต้นทาง</button>
        <button type="button" data-testid="remount" onClick={() => setInstances(value => value + 1)}>ติดตั้งใหม่</button>
        <button
          type="button"
          data-testid="spoof"
          onClick={() => {
            // A message from the page itself: the host must ignore it because it is not the frame.
            window.postMessage({ protocol: 1, kind: 'intent', nonce: NONCE, requestId: 'req-spoof00001', behaviorId: 'allocate', inputs: { room: 'spoof', zone: 'spoof' } }, '*');
          }}
        >
          ปลอมข้อความ
        </button>
      </div>
      {compiled.ok ? (
        <GeneratedToolHost
          key={instances}
          instanceId="layout-instance"
          nonce={NONCE}
          compiled={compiled.compiled}
          ports={ports}
          presentation={presentation}
          onIntent={onIntent}
          onLog={onLog}
          title="ผังพื้นที่กิจกรรม (ตัวอย่าง)"
        />
      ) : (
        <pre role="alert" data-testid="compile-problems">{state.problems.join('\n')}</pre>
      )}
      <p data-testid="intent-count" style={{ fontSize: 12, marginTop: 12 }}>{`intents: ${state.intents.length}`}</p>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('The harness has no root element.');
createRoot(container).render(<Harness />);
