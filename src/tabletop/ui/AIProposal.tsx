import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, FileText, FolderOpen, LoaderCircle, Paperclip, RefreshCw, Sparkles } from 'lucide-react';
import type { ModelJob, TabletopCapabilities } from '../client';
import type { WorkspaceView } from '../shared/contracts';
import { MAX_TABLE_SOURCES, TABLE_TOTAL_SOURCE_BYTES } from '../shared/table-source-limits';
import './account.css';

interface AIProposalProps {
  view: WorkspaceView;
  capabilities: TabletopCapabilities;
  onRequest: (view: WorkspaceView, prompt: string, sourceId: string | undefined, commandId: string) => Promise<ModelJob>;
  onPoll: (workspaceId: string, jobId: string) => Promise<ModelJob>;
  onRefresh: (workspaceId: string) => Promise<void>;
  onAttachFile?: (view: WorkspaceView, file: File) => Promise<WorkspaceView>;
  onOpenSources?: () => void;
  onReviewDraft?: () => void;
  readOnly?: boolean;
  embedded?: boolean;
  prefill?: { text: string; key: number };
}

const completed = (job: ModelJob) => job.status === 'completed' || job.status === 'complete';
const waiting = (job: ModelJob) => job.status === 'queued' || job.status === 'running';
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function proposalErrorMessage(reason: unknown, kind: WorkspaceView['kind']): string {
  const error = reason as { code?: unknown; message?: unknown } | null;
  if (kind === 'table' && error?.code === 'MODEL_PROVIDER_INPUT_TOO_LARGE') {
    return 'This request exceeds the AI input limit. Shorten or remove unused source text, or shorten the request; nothing was activated.';
  }
  return typeof error?.message === 'string' ? error.message : 'The AI request could not be sent.';
}

export function AIProposal({ view, capabilities, onRequest, onPoll, onRefresh, onAttachFile, onOpenSources, onReviewDraft, readOnly = false, embedded = false, prefill }: AIProposalProps) {
  const [prompt, setPrompt] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<ModelJob | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const tableFileInput = useRef<HTMLInputElement>(null);
  const sources = view.kind === 'invoice'
    ? view.domain.kind === 'invoice'
      ? view.domain.sources.filter((source) => source.status === 'verified' && (source.kind === 'rate-card' || source.kind === 'excerpt'))
      : []
    : [];
  const tableSources = view.kind === 'table' && view.domain.kind === 'table' ? view.domain.sources : [];
  const tableCandidate = view.kind === 'table' && view.domain.kind === 'table' ? view.domain.candidate : null;
  const tableDraftPending = tableCandidate !== null && tableCandidate.status !== 'active';
  const sourceScope = tableSources.map((source) => source.id).join('|');

  useEffect(() => {
    generation.current += 1;
    setPrompt('');
    setLastPrompt('');
    setSourceId('');
    setConsent(false);
    setJob(null);
    setMessage('');
    setError('');
    setRequesting(false);
    setAttaching(false);
    setAttachmentError('');
    setChecking(false);
    setRefreshing(false);
  }, [view.id, view.epoch]);

  useEffect(() => {
    if (sourceId && !sources.some((source) => source.id === sourceId)) setSourceId('');
  }, [sourceId, sources]);

  useEffect(() => {
    if (prefill) { setPrompt(prefill.text); setConsent(false); }
  }, [prefill]);

  useEffect(() => { setConsent(false); }, [sourceScope, sourceId]);

  const refreshDraft = async (token: number, finished?: ModelJob) => {
    setRefreshing(true);
    try {
      await onRefresh(view.id);
      // F039: a draft that passed every check is already in use; one that did not waits for a manual review.
      if (generation.current === token) setMessage(finished?.autoApply === 'applied' ? 'The new rules are in use.' : finished?.autoApply === 'needs-review' ? `Draft ready, but it needs a manual review${finished.autoApplyReasons?.length ? `: ${finished.autoApplyReasons.join(' ')}` : '.'}` : 'Draft ready. Open Rules to review it.');
    } catch (reason) {
      if (generation.current === token) setError(reason instanceof Error ? reason.message : 'The table could not be refreshed.');
    } finally {
      if (generation.current === token) setRefreshing(false);
    }
  };

  const applyStatus = async (next: ModelJob, token: number) => {
    if (generation.current !== token) return;
    setJob(next);
    if (next.status === 'failed') setError(next.message || 'The AI proposal could not be completed. You can revise the request or continue with a manual edit.');
    else if (completed(next)) await refreshDraft(token, next);
    else setMessage('The proposal is still being prepared. You can check again in a moment.');
  };

  const pollInBackground = async (jobId: string, token: number) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await pause(1_200);
      if (generation.current !== token) return;
      try {
        const next = await onPoll(view.id, jobId);
        if (generation.current !== token) return;
        setJob(next);
        if (next.status === 'failed') {
          setError(next.message || 'The AI proposal could not be completed. You can revise the request or continue with a manual edit.');
          setMessage('');
          return;
        }
        if (completed(next)) {
          await refreshDraft(token, next);
          return;
        }
      } catch (reason) {
        if (generation.current === token) setError(reason instanceof Error ? reason.message : 'The proposal status could not be checked.');
        return;
      }
    }
    if (generation.current === token) setMessage('The proposal is still processing. Use “Check status” when you want to look again.');
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim() || !consent || readOnly || requesting || attaching || (job && waiting(job)) || (view.kind === 'invoice' && !sourceId) || !capabilities.model.enabled) return;
    const token = ++generation.current;
    const commandId = crypto.randomUUID();
    setConsent(false);
    setRequesting(true);
    setJob(null);
    setLastPrompt(prompt.trim());
    setMessage('Sending your request…');
    setError('');
    try {
      const accepted = await onRequest(view, prompt.trim(), view.kind === 'invoice' ? sourceId : undefined, commandId);
      if (generation.current !== token) return;
      setJob(accepted);
      if (accepted.status === 'failed') {
        setError(accepted.message || 'The AI proposal could not be completed.');
        setMessage('');
      } else if (completed(accepted)) await refreshDraft(token, accepted);
      else {
        setMessage('Request accepted. Checking for a draft…');
        void pollInBackground(accepted.id, token);
      }
    } catch (reason) {
      if (generation.current === token) setError(proposalErrorMessage(reason, view.kind));
      setMessage('');
    } finally {
      if (generation.current === token) setRequesting(false);
    }
  };

  const checkStatus = async () => {
    if (!job || !waiting(job) || checking) return;
    const token = generation.current;
    setChecking(true);
    setError('');
    try { await applyStatus(await onPoll(view.id, job.id), token); }
    catch (reason) { if (generation.current === token) setError(reason instanceof Error ? reason.message : 'The proposal status could not be checked.'); }
    finally { if (generation.current === token) setChecking(false); }
  };

  const attachTableSource = async (file: File) => {
    if (!onAttachFile || view.kind !== 'table' || readOnly) return;
    setConsent(false);
    const token = generation.current;
    setAttaching(true);
    setAttachmentError('');
    try {
      await onAttachFile(view, file);
      if (generation.current === token) setAttachmentError('');
    } catch (reason) {
      if (generation.current === token) setAttachmentError(reason instanceof Error ? reason.message : 'The source file could not be added.');
    } finally {
      if (generation.current === token) setAttaching(false);
    }
  };

  const waitingNow = job ? waiting(job) : false;
  const canSubmit = capabilities.model.enabled && !readOnly && !requesting && !attaching && !waitingNow && consent && prompt.trim().length >= 3 && (view.kind !== 'invoice' || Boolean(sourceId));

  if (view.kind === 'table') {
    const requestStatus = requesting
      ? 'Sending request…'
      : job?.status === 'failed'
        ? 'Request stopped'
        : job && completed(job) && tableDraftPending
          ? 'Draft ready for review'
          : waitingNow
            ? 'Preparing draft'
            : tableDraftPending
              ? 'Draft ready for review'
              : job && completed(job)
                ? 'Request completed'
                : '';
    const sourceBytes = tableSources.reduce((sum, source) => sum + new TextEncoder().encode(source.text).byteLength, 0);
    const attachDisabled = !onAttachFile || readOnly || attaching || requesting || waitingNow || tableSources.length >= MAX_TABLE_SOURCES || sourceBytes >= TABLE_TOTAL_SOURCE_BYTES;

    return <section className={`tt-ai-proposal tt-ai-proposal--table${embedded ? ' tt-ai-proposal--embedded' : ''}`} data-testid={embedded ? undefined : 'table-assistant'} aria-label={embedded ? 'Private rule drafting tools' : undefined} aria-labelledby={embedded ? undefined : 'tt-ai-title'}>
      {!embedded && <header className="tt-ai-proposal__head"><span className="tt-ai-proposal__icon"><Sparkles size={15} /></span><div><span className="tt-kicker">OWNER TOOLS</span><h2 id="tt-ai-title">Table assistant</h2></div><span className="tt-ai-proposal__manual">Rules stay on Canvas</span></header>}
      <section className="tt-table-assistant__files" aria-label={`Table files, ${tableSources.length} of 4`}>
        <header><strong>Your files</strong><span>{tableSources.length} / 4 · private</span></header>
        {tableSources.length > 0 ? <ul>{tableSources.map((source) => <li key={source.id} title={source.filename}><FileText size={13} /><span>{source.filename}</span></li>)}</ul> : <p>No files attached yet.</p>}
        <div className="tt-table-assistant__file-actions">
          <input ref={tableFileInput} type="file" className="tt-table-assistant__file-input" accept=".csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown" aria-label="Choose table source files" tabIndex={-1} onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void attachTableSource(file);
          }} />
          <button type="button" className="tt-button tt-button--quiet" disabled={attachDisabled} onClick={() => tableFileInput.current?.click()}>{attaching ? <LoaderCircle size={14} className="tt-spin" /> : <Paperclip size={14} />}Attach a file</button>
          <button type="button" className="tt-button tt-button--quiet" disabled={!onOpenSources || attaching || requesting || waitingNow} onClick={onOpenSources}><FolderOpen size={14} />View files</button>
        </div>
        <details><summary>File limits</summary><small>UTF-8 CSV, JSON, TXT or Markdown · 32 KiB each · 64 KiB total. Adding a file does not send an AI request.</small></details>
      </section>
      {readOnly && <p className="tt-table-assistant__notice" role="status"><AlertCircle size={14} />Editing and AI requests are temporarily paused. You can still review the current table.</p>}
      {!capabilities.model.enabled && <p className="tt-ai-proposal__unavailable"><AlertCircle size={14} />{capabilities.model.reason || 'AI rule proposals are not enabled for this table. Manual rule editing remains available on Canvas.'}</p>}
      {tableDraftPending && <p className="tt-table-assistant__notice" role="status">Draft ready. Review it, or describe a correction.</p>}
      <form className="tt-ai-proposal__form" data-testid="table-ai-composer" onSubmit={(event) => void submit(event)}>
        <label htmlFor="tt-ai-prompt">How should this table work?</label>
        <textarea id="tt-ai-prompt" value={prompt} maxLength={1200} rows={3} disabled={readOnly || requesting || waitingNow} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe what people should be able to do…" />
        {tableSources.length === 0 && <small className="tt-ai-proposal__source-hint">Start with an idea, or attach a file.</small>}
        <details className="tt-ai-proposal__privacy"><summary>What goes to AI?</summary><p>Your prompt, current rules, shared records, and all {tableSources.length} table file{tableSources.length === 1 ? '' : 's'} go to the AI provider after you agree. Member profiles and activity are excluded. Everyone at this table can read the files; drafts stay private to you. Review the generated rules, views and records before sharing them through activation. A request may make up to three bounded attempts to repair invalid output within the configured budget.</p></details>
        <label className="tt-ai-proposal__consent"><input type="checkbox" checked={consent} disabled={readOnly || requesting || waitingNow} onChange={(event) => setConsent(event.target.checked)} /><span>Send this request, table state and {tableSources.length} source file{tableSources.length === 1 ? '' : 's'} to AI.</span></label>
        <button type="submit" className="tt-button tt-button--primary" aria-label="Prepare rule draft" disabled={!canSubmit}>{requesting ? <LoaderCircle size={14} className="tt-spin" /> : <Sparkles size={14} />}Prepare draft</button>
      </form>
      {attachmentError && <p className="tt-ai-proposal__error" role="alert"><AlertCircle size={14} />{attachmentError}</p>}
      {(requestStatus || lastPrompt) && <div className="tt-table-assistant__status" data-testid="table-assistant-status" role="status" aria-live="polite">
        {requestStatus && <strong>{requestStatus}</strong>}
        {lastPrompt && <details><summary>Request details</summary><p>{lastPrompt}</p></details>}
        {(job?.message || message) && <p>{job?.message || message}</p>}
        {waitingNow && <button type="button" className="tt-button tt-button--quiet" onClick={() => void checkStatus()} disabled={checking}>{checking ? <LoaderCircle size={13} className="tt-spin" /> : <RefreshCw size={13} />}Check status</button>}
        {job && completed(job) && <button type="button" className="tt-button tt-button--quiet" onClick={() => void refreshDraft(generation.current, job ?? undefined)} disabled={refreshing}>{refreshing ? <LoaderCircle size={13} className="tt-spin" /> : <RefreshCw size={13} />}Refresh table</button>}
        {tableDraftPending && <button type="button" className="tt-button tt-button--quiet" onClick={onReviewDraft}>Review draft</button>}
      </div>}
      {error && <p className="tt-ai-proposal__error" role="alert"><AlertCircle size={14} />{error}</p>}
      {!capabilities.model.enabled && <p className="tt-ai-proposal__footer">Manual rules, file review and lifecycle controls remain available on the Canvas.</p>}
    </section>;
  }

  return <section className="tt-ai-proposal" id="tt-ai-proposal" aria-labelledby="tt-ai-title">
    <header className="tt-ai-proposal__head"><div><h2 id="tt-ai-title">Change rules</h2></div></header>
    {!capabilities.model.enabled ? <p className="tt-ai-proposal__unavailable"><AlertCircle size={14} />{capabilities.model.reason || 'AI proposals are not enabled for this table.'}</p> : <>
      <form className="tt-ai-proposal__form" onSubmit={(event) => void submit(event)}>
        {view.kind === 'invoice' && <label className="tt-ai-proposal__source" htmlFor="tt-ai-source">Verified rate evidence
          <select id="tt-ai-source" value={sourceId} onChange={(event) => setSourceId(event.target.value)} required>
            <option value="">Choose a verified rate card or excerpt</option>
            {sources.map((source) => <option value={source.id} key={source.id}>{source.filename} · {source.kind}</option>)}
          </select>
          {sources.length === 0 && <small>Review a rate card or excerpt as verified before asking for an invoice draft.</small>}
        </label>}
        <label htmlFor="tt-ai-prompt">What would you like to change?</label>
        <textarea id="tt-ai-prompt" value={prompt} maxLength={1200} rows={3} onChange={(event) => setPrompt(event.target.value)} placeholder={view.kind === 'invoice' ? 'Describe the rate change to compare against this verified evidence…' : view.kind === 'teaching' ? 'Describe a teaching adjustment for the current lesson…' : 'Describe a bounded shield-rule proposal for this encounter…'} />
        <details className="tt-ai-proposal__privacy"><summary>What goes to AI?</summary><p>Only your prompt and relevant current rules or parameters are sent. {view.kind === 'invoice' ? 'The verified excerpt you select is included.' : ''} Private notes and learner answers are excluded.</p></details>
        <label className="tt-ai-proposal__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Send this request and current {view.kind === 'invoice' ? 'rules with the selected evidence' : 'rules or parameters'} to AI.</span></label>
        <button type="submit" className="tt-button tt-button--primary" disabled={!canSubmit}>{requesting ? <LoaderCircle size={14} className="tt-spin" /> : <Sparkles size={14} />}Prepare draft</button>
      </form>
      {(requesting || job) && <div className="tt-ai-proposal__job" role="status" aria-live="polite"><span className={`tt-ai-proposal__job-mark${job && completed(job) ? ' is-done' : ''}`}>{job && completed(job) ? <Check size={14} /> : <LoaderCircle size={14} className="tt-spin" />}</span><span><strong>{job?.status === 'failed' ? 'Request stopped' : completed(job ?? { id: '', status: 'queued' }) ? (job?.autoApply === 'applied' ? 'Rules in use' : 'Draft ready for review') : 'Preparing draft'}</strong><small>{job?.message || message || (waitingNow ? 'This can take a little while.' : '')}</small></span>{waitingNow && <button type="button" className="tt-button tt-button--quiet" onClick={() => void checkStatus()} disabled={checking}>{checking ? <LoaderCircle size={13} className="tt-spin" /> : <RefreshCw size={13} />} Check status</button>}{job && completed(job) && <button type="button" className="tt-button tt-button--quiet" onClick={() => void refreshDraft(generation.current, job ?? undefined)} disabled={refreshing}>{refreshing ? <LoaderCircle size={13} className="tt-spin" /> : <RefreshCw size={13} />} Refresh table</button>}</div>}
      {message && !requesting && !job && <p className="tt-ai-proposal__message" role="status">{message}</p>}
      {error && <p className="tt-ai-proposal__error" role="alert"><AlertCircle size={14} />{error}</p>}
      {job && completed(job) && <p className="tt-ai-proposal__footer">{job.autoApply === 'applied' ? 'The new rules passed every check and are in use. Open Rules to see them.' : 'Review the draft on Canvas before using it.'}</p>}
    </>}
  </section>;
}
