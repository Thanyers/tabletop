import { useState } from 'react';
import './room-setup.css';
import { buildToolInstallInput, type ToolInstallTool } from './tool-install-input';

/**
 * F080 / D-051: install a tool package in the room by pasting its JSON.
 *
 * There is no package store yet (D-037), so the package text is the input. The hash is computed from
 * that text and the Worker re-checks it, so the panel cannot install anything the package does not say.
 */

export interface ToolInstallOutcome {
  ok: boolean;
  message: string;
}

export interface ToolInstallPanelProps {
  /** Runs `space.installTool` for the room and reports what the authority answered. */
  installTool: (tool: ToolInstallTool) => Promise<ToolInstallOutcome>;
  /** Hide the panel once a tool is installed, so the room shows the tool instead. */
  onInstalled?: () => void;
}

export function ToolInstallPanel(props: ToolInstallPanelProps): React.ReactElement {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ToolInstallOutcome | undefined>();

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const built = await buildToolInstallInput(text);
      if (!built.ok) {
        setResult({ ok: false, message: built.problem });
        return;
      }
      const outcome = await props.installTool(built.tool);
      setResult(outcome);
      if (outcome.ok) props.onInstalled?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tt-setup" data-testid="tool-install">
      <h2 className="tt-setup__title">ติดตั้งเครื่องมือให้ห้องนี้</h2>
      <p className="tt-setup__hint">
        วาง JSON ของ tool package ที่เปิดใช้แล้ว: ที่อยู่ของเครื่องมือจะคำนวณจากเนื้อหาของ package เอง
      </p>
      <form className="tt-setup__form" onSubmit={submit}>
        <label className="tt-setup__field">
          JSON ของ package
          <textarea
            className="tt-setup__text"
            data-testid="tool-install-json"
            value={text}
            onChange={event => setText(event.target.value)}
            rows={8}
            spellCheck={false}
            placeholder='{ "schemaVersion": 1, "packageId": "…" }'
            required
          />
        </label>
        <button type="submit" className="tt-setup__submit" data-testid="tool-install-submit" disabled={busy || text.trim().length === 0}>
          {busy ? 'กำลังติดตั้ง…' : 'ติดตั้งเครื่องมือ'}
        </button>
      </form>
      {result ? (
        <p className={result.ok ? 'tt-setup__ok' : 'tt-setup__problem'} role="status" data-testid="tool-install-result">
          {result.message}
        </p>
      ) : null}
    </section>
  );
}
