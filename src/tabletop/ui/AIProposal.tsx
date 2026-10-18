import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';
import type { ModelJob, TabletopCapabilities } from '../client';
import type { WorkspaceView } from '../shared/contracts';
import './account.css';

interface AIProposalProps {
  view: WorkspaceView;
  capabilities: TabletopCapabilities;
  onRequest: (view: WorkspaceView, prompt: string, sourceId: string | undefined, commandId: string) => Promise<ModelJob>;
  onPoll: (workspaceId: string, jobId: string) => Promise<ModelJob>;
  onRefresh: (workspaceId: string) => Promise<void>;
}

const completed = (job: ModelJob) => job.status === 'completed' || job.status === 'complete';
const waiting = (job: ModelJob) => job.status === 'queued' || job.status === 'running';
const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function AIProposal({ view, capabilities, onRequest, onPoll, onRefresh }: AIProposalProps) {
  const [prompt, setPrompt] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<ModelJob | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const sources = view.kind === 'invoice'
    ? view.domain.kind === 'invoice'
      ? view.domain.sources.filter((source) => source.status === 'verified' && (source.kind === 'rate-card' || source.kind === 'excerpt'))
      : []
    : [];

  useEffect(() => {
    generation.current += 1;
    setPrompt('');
    setSourceId('');
    setConsent(false);
    setJob(null);
    setMessage('');
    setError('');
    setRequesting(false);
    setChecking(false);
    setRefreshing(false);
  }, [view.id, view.epoch]);

  useEffect(() => {
    if (sourceId && !sources.some((source) => source.id === sourceId)) setSourceId('');
  }, [sourceId, sources]);

  const refreshDraft = async (token: number) => {
    setRefreshing(true);
    try {
      await onRefresh(view.id);
      if (generation.current === token) setMessage('Draft status refreshed. Review it in the table lifecycle before taking any next step.');
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
    else if (completed(next)) await refreshDraft(token);
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
          await refreshDraft(token);
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
    if (!prompt.trim() || !consent || (view.kind === 'invoice' && !sourceId) || !capabilities.model.enabled) return;
    const token = ++generation.current;
    const commandId = crypto.randomUUID();
    setRequesting(true);
    setJob(null);
    setMessage('Sending your request…');
    setError('');
    try {
      const accepted = await onRequest(view, prompt.trim(), view.kind === 'invoice' ? sourceId : undefined, commandId);
      if (generation.current !== token) return;
      setJob(accepted);
      if (accepted.status === 'failed') {
        setError(accepted.message || 'The AI proposal could not be completed.');
        setMessage('');
      } else if (completed(accepted)) await refreshDraft(token);
      else {
        setMessage('Request accepted. Checking for a draft…');
        void pollInBackground(accepted.id, token);
      }
    } catch (reason) {
      if (generation.current === token) setError(reason instanceof Error ? reason.message : 'The AI request could not be sent.');
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

  const waitingNow = job ? waiting(job) : false;
  const canSubmit = capabilities.model.enabled && !requesting && consent && prompt.trim().length > 0 && (view.kind !== 'invoice' || Boolean(sourceId));

  return <section className="tt-ai-proposal" id="tt-ai-proposal" aria-labelledby="tt-ai-title">
    <header className="tt-ai-proposal__head"><span className="tt-ai-proposal__icon"><Sparkles size={15} /></span><div><span className="tt-kicker">OPTIONAL ASSISTANCE</span><h2 id="tt-ai-title">Ask AI for a draft</h2></div><span className="tt-ai-proposal__manual">Manual rules stay available</span></header>
    {!capabilities.model.enabled ? <p className="tt-ai-proposal__unavailable"><AlertCircle size={14} />{capabilities.model.reason || 'AI proposals are not enabled for this table.'}</p> : <>
      <form className="tt-ai-proposal__form" onSubmit={(event) => void submit(event)}>
        {view.kind === 'invoice' && <label className="tt-ai-proposal__source" htmlFor="tt-ai-source">Verified rate evidence
          <select id="tt-ai-source" value={sourceId} onChange={(event) => setSourceId(event.target.value)} required>
            <option value="">Choose a verified rate card or excerpt</option>
            {sources.map((source) => <option value={source.id} key={source.id}>{source.filename} · {source.kind}</option>)}
          </select>
          {sources.length === 0 && <small>Review a rate card or excerpt as verified before asking for an invoice draft.</small>}
        </label>}
        <label htmlFor="tt-ai-prompt">What should the draft change or explain?</label>
        <textarea id="tt-ai-prompt" value={prompt} maxLength={1200} rows={3} onChange={(event) => setPrompt(event.target.value)} placeholder={view.kind === 'invoice' ? 'Describe the rate change to compare against this verified evidence…' : view.kind === 'teaching' ? 'Describe a teaching adjustment for the current lesson…' : 'Describe a bounded shield-rule proposal for this encounter…'} />
        <div className="tt-ai-proposal__privacy"><strong>Before you send</strong><p>Only your prompt and the relevant current rules or parameters will be sent. For an invoice, the verified excerpt you select is included. Private notes and learner answers are excluded.</p></div>
        <label className="tt-ai-proposal__consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to send this request for an AI draft.</span></label>
        <button type="submit" className="tt-button tt-button--primary" disabled={!canSubmit}>{requesting ? <LoaderCircle size={14} className="tt-spin" /> : <Sparkles size={14} />} Ask AI for a draft</button>
      </form>
      {(requesting || job) && <div className="tt-ai-proposal__job" role="status" aria-live="polite"><span className={`tt-ai-proposal__job-mark${job && completed(job) ? ' is-done' : ''}`}>{job && completed(job) ? <Check size={14} /> : <LoaderCircle size={14} className="tt-spin" />}</span><span><strong>{job?.status === 'failed' ? 'Request stopped' : completed(job ?? { id: '', status: 'queued' }) ? 'Draft ready for review' : 'Preparing draft'}</strong><small>{job?.message || message || (waitingNow ? 'This can take a little while.' : '')}</small></span>{waitingNow && <button type="button" className="tt-button tt-button--quiet" onClick={() => void checkStatus()} disabled={checking}>{checking ? <LoaderCircle size={13} className="tt-spin" /> : <RefreshCw size={13} />} Check status</button>}{job && completed(job) && <button type="button" className="tt-button tt-button--quiet" onClick={() => void refreshDraft(generation.current)} disabled={refreshing}>{refreshing ? <LoaderCircle size={13} className="tt-spin" /> : <RefreshCw size={13} />} Refresh table</button>}</div>}
      {message && !requesting && !job && <p className="tt-ai-proposal__message" role="status">{message}</p>}
      {error && <p className="tt-ai-proposal__error" role="alert"><AlertCircle size={14} />{error}</p>}
      {job && completed(job) && <p className="tt-ai-proposal__footer">AI suggestions create a draft only. Review and use the table’s existing simulation and approval steps; nothing is activated automatically.</p>}
    </>}
  </section>;
}
