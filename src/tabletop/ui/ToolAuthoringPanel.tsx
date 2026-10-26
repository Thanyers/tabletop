import { useCallback, useMemo, useState, useRef } from 'react';
import { validateToolPackage, type ToolPackageDefinition } from '../shared/tool-package';
import { compileToolPackage } from '../runtime/tools/compile';
import type { ToolAuthoringResult } from '../runtime/tools/authoring';

/**
 * F080 / C3: the authoring panel a person uses to edit a package's source and activate it.
 *
 * The panel is deliberately thin. It does not compile, validate twice, or decide anything: it hands
 * the edited source to the same pipeline the AI route uses (`authorToolPackage`), renders the
 * diagnostics that come back, and shows the activation record so the person can see what was
 * activated, at which version, by which route, and with which content hash.
 */

export interface ToolAuthoringPanelProps {
  /** The package as it is today; the panel edits a copy of its files. */
  initial: ToolPackageDefinition;
  /** Runs the shared pipeline. The AI route would be wired here too, never in the panel. */
  author: (definition: unknown, baseContentHash: string | undefined) => Promise<ToolAuthoringResult>;
  /** Who is editing; recorded in the activation record by the pipeline. */
  actorId: string;
  /** Called after a successful activation so the caller can refresh its own state. */
  onActivated?: (definition: ToolPackageDefinition, contentHash: string) => void;
}

/** A problem from either step, flattened so the panel has one list to show. */
interface ShownProblem {
  code: string;
  path: string;
  message: string;
}

interface EditableFile {
  path: string;
  language: 'tsx' | 'ts' | 'js';
  text: string;
}

function filesOf(definition: ToolPackageDefinition): EditableFile[] {
  return definition.files.map(file => ({ path: file.path, language: file.language, text: file.text }));
}

/** Stable placeholder hash for a compile preview; the pipeline computes the real content hash. */
function hashStandIn(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

export function ToolAuthoringPanel(props: ToolAuthoringPanelProps): React.ReactElement {
  const [files, setFiles] = useState<EditableFile[]>(() => filesOf(props.initial));
  const [activePath, setActivePath] = useState<string>(() => props.initial.uiEntry);
  const [problems, setProblems] = useState<ShownProblem[]>([]);
  const [result, setResult] = useState<ToolAuthoringResult | undefined>();
  const [busy, setBusy] = useState(false);
  /** Feedback for a check, because a passing check otherwise looks like a click that did nothing. */
  const [checkNote, setCheckNote] = useState('');
  const checkCount = useRef(0);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const tablistRef = useRef<HTMLDivElement | null>(null);

  /** Rebuild the definition the person is editing, keeping everything except the source text. */
  const draft = useMemo<ToolPackageDefinition>(() => ({
    ...props.initial,
    files: props.initial.files.map(file => ({
      ...file,
      text: files.find(edited => edited.path === file.path)?.text ?? file.text,
    })),
  }), [files, props.initial]);

  const active = files.find(file => file.path === activePath) ?? files[0];

  /**
   * Check runs the same two gates the pipeline runs first — structure, then compile — so a syntax
   * error is visible before the person asks to activate, and not only after a failed activation.
   */
  const check = useCallback(() => {
    checkCount.current += 1;
    const round = checkCount.current;
    const validation = validateToolPackage(draft);
    if (!validation.ok) {
      setProblems(validation.problems.map(problem => ({ code: problem.code, path: problem.path, message: problem.message })));
      setResult(undefined);
      setCheckNote(`ตรวจครั้งที่ ${round}: ไม่ผ่าน ${validation.problems.length} จุด — แก้แล้วตรวจใหม่`);
      return false;
    }
    const compiled = compileToolPackage(validation.package, hashStandIn);
    setProblems(compiled.ok ? [] : compiled.problems.map(problem => ({ code: problem.code, path: problem.path, message: problem.message })));
    setResult(undefined);
    setCheckNote(compiled.ok
      ? `ตรวจครั้งที่ ${round}: โครงสร้างและ compile ผ่าน — พร้อม activate`
      : `ตรวจครั้งที่ ${round}: compile ไม่ผ่าน ${compiled.problems.length} จุด`);
    return compiled.ok;
  }, [draft]);

  const activate = useCallback(async () => {
    if (!check()) return;
    setBusy(true);
    try {
      const activation = await props.author(draft, props.initial.provenance.baseContentHash);
      setResult(activation);
      if (activation.ok) props.onActivated?.(activation.definition, activation.contentHash);
    } finally {
      setBusy(false);
    }
  }, [check, draft, props]);

  const status = busy
    ? 'กำลังตรวจและเปิดใช้…'
    : result === undefined
      ? 'ยังไม่ได้เปิดใช้รอบนี้'
      : result.ok
        ? `เปิดใช้แล้ว: ${result.record.packageId} v${result.record.version}`
        : `ไม่เปิดใช้: ${result.code}`;

  return (
    <section aria-label="แก้ source ของเครื่องมือ" style={{ font: '14px/1.6 system-ui, sans-serif', display: 'grid', gap: 10 }}>
      <header style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong data-testid="package-title">{props.initial.title}</strong>
        <span data-testid="package-version" style={{ fontSize: 12, opacity: 0.75 }}>{`v${props.initial.version} · ${props.initial.packageId}`}</span>
      </header>

      <div role="tablist" aria-label="ไฟล์ในแพ็กเกจ" ref={tablistRef} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
        onKeyDown={event => {
          const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
          if (step === 0) return;
          event.preventDefault();
          const index = files.findIndex(file => file.path === activePath);
          const next = files[(index + step + files.length) % files.length];
          if (!next) return;
          setActivePath(next.path);
          // Focus follows selection, which is what makes the tablist usable from the keyboard.
          requestAnimationFrame(() => tablistRef.current?.querySelector<HTMLButtonElement>(`[data-testid="file-tab-${next.path}"]`)?.focus());
        }}
      >
        {files.map(file => (
          <button
            key={file.path}
            type="button"
            role="tab"
            aria-selected={file.path === activePath}
            tabIndex={file.path === activePath ? 0 : -1}
            data-testid={`file-tab-${file.path}`}
            onClick={() => {
              setActivePath(file.path);
              // Move the caret into the file that was chosen, so a click always does something visible.
              requestAnimationFrame(() => editorRef.current?.focus());
            }}
            style={{ padding: '4px 10px', borderRadius: 8, border: file.path === activePath ? '2px solid #1f6feb' : '1px solid #9aa4ae', background: '#fff' }}
          >
            {file.path}
          </button>
        ))}
      </div>

      {active ? (
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>{`source: ${active.path}`}</span>
          <textarea
            ref={editorRef}
            data-testid="source-editor"
            aria-label={`source ของ ${active.path}`}
            value={active.text}
            spellCheck={false}
            rows={12}
            onChange={event => {
              const text = event.target.value;
              setFiles(current => current.map(file => (file.path === active.path ? { ...file, text } : file)));
              setResult(undefined);
            }}
            style={{ width: '100%', font: '12px/1.5 ui-monospace, monospace', padding: 8, borderRadius: 8, border: '1px solid #9aa4ae', resize: 'vertical' }}
          />
        </label>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <p data-testid="check-note" aria-live="polite" style={{ margin: 0, fontSize: 12, minHeight: 18 }}>{checkNote}</p>
        <button type="button" data-testid="validate" onClick={check} style={{ padding: '6px 12px', borderRadius: 8 }}>
          ตรวจ source
        </button>
        <button type="button" data-testid="activate" onClick={() => void activate()} disabled={busy} style={{ padding: '6px 12px', borderRadius: 8 }}>
          ตรวจและเปิดใช้
        </button>
      </div>

      <p data-testid="status" aria-live="polite" style={{ margin: 0, fontSize: 13 }}>{status}</p>

      <ul data-testid="problems" aria-live="polite" style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#b3261e' }}>
        {(result && !result.ok
          ? result.record.problems.map((message, index) => <li key={index}>{message}</li>)
          : problems.map(problem => <li key={`${problem.code}-${problem.path}`}>{`${problem.code} ${problem.path}: ${problem.message}`}</li>))}
      </ul>

      {result?.ok ? (
        <dl data-testid="activation-readback" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: 12, margin: 0 }}>
          <dt>version</dt><dd data-testid="readback-version">{result.record.version}</dd>
          <dt>content hash</dt><dd data-testid="readback-hash" style={{ fontFamily: 'ui-monospace, monospace' }}>{result.contentHash.slice(0, 12)}…</dd>
          <dt>route</dt><dd data-testid="readback-generator">{result.record.generator.kind}</dd>
          <dt>reviewer</dt><dd data-testid="readback-reviewer">{result.record.reviewer.kind}</dd>
          <dt>requester</dt><dd data-testid="readback-requester">{result.record.requesterActorId}</dd>
        </dl>
      ) : null}
    </section>
  );
}
