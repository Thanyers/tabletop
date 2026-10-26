import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  type ToolPackageDefinition,
} from '../shared/tool-package';

/**
 * F080 / JT-5: the held-out packages.
 *
 * These two exist to be authored *after* the package host was built, from a shape the built-in
 * canvas kinds do not have: a learning tool that scores answers and a play tool that moves pieces
 * on a board. If either needed a new branch in the host, the host would not be general — so the
 * accompanying test scans the host for these ids and for use-case words.
 *
 * They are fixtures, not product code: no network, no storage, no randomness the server must trust.
 */

const QUIZ_UI = `import { useState } from 'react';

type Port = { portId: string; status: string; rows?: { id: string; values: Record<string, string | number | boolean | null> }[] };
type Props = { sdk: unknown; ports: Port[] };

export function Tool({ sdk, ports }: Props) {
  const typed = sdk as { intent: (id: string, inputs: Record<string, string | number | boolean>) => Promise<{ status: string; code?: string }> };
  const questions = ports.find((port) => port.portId === 'questions');
  const rows = questions && questions.rows ? questions.rows : [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  const submit = async () => {
    const outcome = await typed.intent('submit', { answer: Object.values(answers).join(',') });
    setNote(outcome.status === 'committed' ? 'บันทึกคำตอบแล้ว' : 'ยังบันทึกไม่ได้: ' + String(outcome.code ?? 'unknown'));
  };

  return (
    <section aria-label="แบบฝึกหัด" style={{ font: '14px/1.6 system-ui, sans-serif', padding: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>แบบฝึกหัด</h3>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        {rows.map((row) => (
          <li key={row.id} style={{ marginBottom: 8 }}>
            <div>{String(row.values.prompt ?? '')}</div>
            {['a', 'b'].map((choice) => (
              <button
                key={choice}
                type="button"
                data-testid={'answer-' + row.id + '-' + choice}
                aria-pressed={answers[row.id] === choice}
                onClick={() => setAnswers({ ...answers, [row.id]: choice })}
                style={{ marginRight: 6, padding: '2px 10px', borderRadius: 8 }}
              >
                {choice.toUpperCase()}
              </button>
            ))}
          </li>
        ))}
      </ol>
      <button type="button" data-testid="submit-answers" onClick={submit} style={{ padding: '4px 12px', borderRadius: 8 }}>
        ส่งคำตอบ
      </button>
      <p data-testid="quiz-note" aria-live="polite" style={{ minHeight: 18, margin: '6px 0 0', fontSize: 12 }}>{note}</p>
    </section>
  );
}
`;

const QUIZ_BEHAVIOUR = `type Inputs = Record<string, unknown>;

export function submit(inputs: Inputs) {
  const answer = String(inputs.answer ?? '');
  if (answer.length === 0) throw new Error('answer is required');
  return [{ target: 'self', resource: 'responses', operation: 'create', values: { answer } }];
}
`;

const BOARD_UI = `import { useState } from 'react';

type Port = { portId: string; status: string; rows?: { id: string; values: Record<string, string | number | boolean | null> }[] };
type Props = { sdk: unknown; ports: Port[] };

export function Tool({ sdk, ports }: Props) {
  const typed = sdk as { intent: (id: string, inputs: Record<string, string | number | boolean>) => Promise<{ status: string; code?: string }> };
  const board = ports.find((port) => port.portId === 'boats');
  const rows = board && board.rows ? board.rows : [];
  const [moved, setMoved] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const advance = async (boatId: string) => {
    const outcome = await typed.intent('advance', { boat: boatId });
    setMoved(boatId);
    setNote(outcome.status === 'committed' ? 'เดินเรือแล้ว: ' + boatId : 'ถูกปฏิเสธ: ' + String(outcome.code ?? 'unknown'));
  };

  return (
    <section aria-label="กระดานเดินเรือ" style={{ font: '14px/1.6 system-ui, sans-serif', padding: 12 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>กระดานเดินเรือ</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {rows.map((row) => (
          <li key={row.id} data-testid={'boat-' + row.id}>
            <span style={{ marginRight: 8 }}>{String(row.values.seat ?? row.id) + ' · ' + String(row.values.score ?? 0)}</span>
            <button type="button" data-testid={'advance-' + row.id} onClick={() => advance(row.id)} style={{ padding: '2px 10px', borderRadius: 8 }}>
              เดิน
            </button>
          </li>
        ))}
      </ul>
      <p data-testid="board-note" aria-live="polite" style={{ minHeight: 18, margin: '6px 0 0', fontSize: 12 }}>{moved ? note : ''}</p>
    </section>
  );
}
`;

const BOARD_BEHAVIOUR = `type Inputs = Record<string, unknown>;

export function advance(inputs: Inputs) {
  const boat = String(inputs.boat ?? '');
  if (!boat) throw new Error('boat is required');
  return [{ target: 'self', resource: 'boats', operation: 'update', rowId: boat, values: { score: 1 } }];
}
`;

export const HELD_OUT_LEARNING: ToolPackageDefinition = {
  schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
  packageId: 'quiz-hall',
  version: 1,
  title: 'แบบฝึกหัด',
  description: 'ถาม-ตอบพร้อมบันทึกคำตอบ',
  uiEntry: 'ui/quiz.tsx',
  behaviorEntry: 'behavior/submit.ts',
  files: [
    { path: 'ui/quiz.tsx', language: 'tsx', text: QUIZ_UI },
    { path: 'behavior/submit.ts', language: 'ts', text: QUIZ_BEHAVIOUR },
  ],
  ports: [{ id: 'questions', label: 'คำถาม', direction: 'in', kind: 'records', fields: ['prompt'], maxRows: 20 }],
  behaviors: [{
    id: 'submit',
    label: 'ส่งคำตอบ',
    entry: 'submit',
    inputs: [{ id: 'answer', label: 'คำตอบ', kind: 'text', required: true }],
    writes: [{ target: 'self', resource: 'responses', operations: ['create'], maxRows: 10 }],
  }],
  imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  provenance: { origin: 'human', createdAt: 1_760_000_000_000 },
};

export const HELD_OUT_PLAY: ToolPackageDefinition = {
  schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
  packageId: 'boat-race',
  version: 1,
  title: 'กระดานเดินเรือ',
  description: 'เลือกเรือแล้วเดินทีละลำ',
  uiEntry: 'ui/board.tsx',
  behaviorEntry: 'behavior/advance.ts',
  files: [
    { path: 'ui/board.tsx', language: 'tsx', text: BOARD_UI },
    { path: 'behavior/advance.ts', language: 'ts', text: BOARD_BEHAVIOUR },
  ],
  ports: [{ id: 'boats', label: 'เรือ', direction: 'in', kind: 'records', fields: ['seat', 'score'], maxRows: 12 }],
  behaviors: [{
    id: 'advance',
    label: 'เดินเรือ',
    entry: 'advance',
    inputs: [{ id: 'boat', label: 'เรือ', kind: 'text', required: true }],
    writes: [{ target: 'self', resource: 'boats', operations: ['update'], maxRows: 4 }],
  }],
  imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  provenance: { origin: 'ai', createdAt: 1_760_000_100_000 },
};

/**
 * Tokens the host must never contain for these packages to be general.
 *
 * They are the package ids plus their most distinctive identifiers — not ordinary English words
 * such as "answer", which the host legitimately uses in prose and would produce false positives.
 */
export const HELD_OUT_MARKERS = ['quiz-hall', 'boat-race', 'submit-answers', 'advance-', 'responses'] as const;
