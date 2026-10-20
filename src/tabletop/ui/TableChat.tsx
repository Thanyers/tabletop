import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, Paperclip, X } from 'lucide-react';
import { consentKey, consentQuestion, needsConsent, rememberConsent, storedConsent, type TableChatConsentScope, type TableChatMode } from './table-chat-consent';
import './table-chat.css';

const MAX_MESSAGE_CHARS = 1200;
const MAX_ROWS = 5;

export interface TableChatProps {
  workspaceId: string;
  epoch: number;
  actorId: string;
  mode: TableChatMode;
  /** Current table files are shown by name in the one-time consent for both endpoints. */
  sourceFiles: readonly { id: string; filename: string }[];
  placeholder: string;
  aiEnabled: boolean;
  canAttach: boolean;
  busy: boolean;
  acceptFiles?: string;
  historyStatus?: 'loading' | 'ready' | 'error';
  onRetryHistory?: () => void;
  /** Text to place in the box, e.g. a description typed on the start page. */
  prefill?: { text: string; key: number };
  /** Clears a retained composer message after a lost-ack retry is acknowledged. */
  acknowledged?: { prompt: string; key: string };
  /** Changes when an explicit Rules-card action should focus this same composer. */
  focusKey?: number;
  /** True only while the owner has explicitly entered active-table rule editing. */
  explicitRuleEdit?: boolean;
  onCancelRuleEdit?: () => void;
  onAttach: (file: File) => Promise<void>;
  /** Resolves true only when the server has acknowledged this request. */
  onSend: (message: string) => Promise<boolean>;
}

/** One-line chat box fixed to the bottom centre of a shared table (F006). */
export function TableChat({
  workspaceId, epoch, actorId, mode, sourceFiles, placeholder, aiEnabled, canAttach, busy,
  acceptFiles, historyStatus = 'ready', onRetryHistory, prefill, acknowledged, focusKey = 0,
  explicitRuleEdit = false, onCancelRuleEdit, onAttach, onSend,
}: TableChatProps) {
  const [message, setMessage] = useState('');
  const [grantedKey, setGrantedKey] = useState<string | null>(() => storedConsent({ workspaceId, epoch, actorId }));
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [sendError, setSendError] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef(message);
  messageRef.current = message;
  const appliedAcknowledgement = useRef<string | null>(null);
  const sendLock = useRef(false);
  const idPrefix = useId().replaceAll(':', '');
  const messageId = `tt-table-chat-message-${idPrefix}`;
  const scope: TableChatConsentScope = { workspaceId, epoch, actorId };
  const scopeKey = consentKey(scope);
  const trimmed = message.trim();
  const historyBlocked = mode === 'ask' && historyStatus !== 'ready';
  const controlsBusy = busy || sending || attaching;
  const canSend = aiEnabled && !controlsBusy && !historyBlocked && trimmed.length >= 3;

  useEffect(() => {
    setGrantedKey(storedConsent(scope));
    setAsking(false);
    // scopeKey captures every field of scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    if (prefill) setMessage(prefill.text.slice(0, MAX_MESSAGE_CHARS));
  }, [prefill]);

  useEffect(() => {
    if (!acknowledged || acknowledged.key === appliedAcknowledgement.current) return;
    appliedAcknowledgement.current = acknowledged.key;
    if (messageRef.current.trim() !== acknowledged.prompt) return;
    setMessage('');
    setSendError('');
  }, [acknowledged]);

  useEffect(() => {
    if (focusKey > 0) fieldRef.current?.focus();
  }, [focusKey]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight) || 22;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, lineHeight * MAX_ROWS)}px`;
  }, [message]);

  const send = async () => {
    if (sendLock.current || !canSend) return;
    sendLock.current = true;
    setAsking(false);
    setSending(true);
    setSendError('');
    const submitted = trimmed;
    try {
      const accepted = await onSend(submitted);
      if (accepted) {
        setMessage((current) => current.trim() === submitted ? '' : current);
      }
    } catch (error) {
      setSendError(error instanceof Error && error.message ? error.message : 'The request could not be confirmed. Your message is still here.');
    } finally {
      sendLock.current = false;
      setSending(false);
      fieldRef.current?.focus();
    }
  };

  const submit = () => {
    if (!canSend) return;
    if (needsConsent(grantedKey, scope)) setAsking(true);
    else void send();
  };

  const attach = async (file: File) => {
    setAttachmentError('');
    setAttaching(true);
    try { await onAttach(file); }
    catch (error) { setAttachmentError(error instanceof Error && error.message ? error.message : 'This file could not be added.'); }
    finally { setAttaching(false); }
  };

  const cancelRuleEdit = () => {
    setMessage('');
    setAsking(false);
    setSendError('');
    onCancelRuleEdit?.();
  };

  return <div className="tt-table-chat-bar" data-testid="table-chat-bar">
    {historyStatus === 'loading' && mode === 'ask' && <p className="tt-table-chat-bar__status" role="status"><LoaderCircle size={13} className="tt-spin" />Loading private conversation…</p>}
    {historyStatus === 'error' && mode === 'ask' && <p className="tt-table-chat-bar__status is-error" role="alert">Private conversation history could not be loaded. <button type="button" className="tt-table-chat-bar__retry" onClick={onRetryHistory}>Retry</button></p>}
    {attachmentError && <p className="tt-table-chat-bar__status is-error" role="alert">{attachmentError}</p>}
    {sendError && <p className="tt-table-chat-bar__status is-error" role="alert">{sendError}</p>}
    {asking && <div className="tt-table-chat-bar__consent" role="alertdialog" aria-label="Send to AI">
      <div className="tt-table-chat-bar__consent-copy">
        <span>{consentQuestion(mode)}</span>
        <span className="tt-table-chat-bar__source-label">{mode === 'draft' ? 'Table files included' : 'Table files not sent'}</span>
        {sourceFiles.length > 0 ? <ul aria-label={mode === 'draft' ? 'Included source files' : 'Excluded source files'}>
          {sourceFiles.map((source) => <li key={source.id}>{source.filename}</li>)}
        </ul> : <small>No table files are attached.</small>}
      </div>
      <div className="tt-table-chat-bar__consent-actions">
        <button type="button" className="tt-table-chat-bar__consent-yes" disabled={!canSend} onClick={() => { setGrantedKey(rememberConsent(scope)); void send(); }}>Send</button>
        <button type="button" className="tt-table-chat-bar__consent-no" onClick={() => { setAsking(false); fieldRef.current?.focus(); }}>Cancel</button>
      </div>
    </div>}
    <form className="tt-table-chat-bar__box" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {canAttach && <>
        <button type="button" className="tt-table-chat-bar__icon" aria-label="Attach a file" disabled={controlsBusy} onClick={() => fileRef.current?.click()}><Paperclip size={17} /></button>
        <input ref={fileRef} type="file" hidden accept={acceptFiles} aria-label="Choose a file to attach" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void attach(file);
        }} />
      </>}
      {explicitRuleEdit && <button type="button" className="tt-table-chat-bar__cancel-edit" aria-label="Cancel rule edit" title="Cancel rule edit" disabled={controlsBusy} onClick={cancelRuleEdit}><X size={16} /></button>}
      <label className="tt-visually-hidden" htmlFor={messageId}>Message</label>
      <textarea id={messageId} ref={fieldRef} rows={1} value={message} maxLength={MAX_MESSAGE_CHARS} placeholder={placeholder} disabled={controlsBusy}
        onChange={(event) => { setMessage(event.target.value); setAsking(false); setSendError(''); }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit();
        }} />
      <button type="submit" className="tt-table-chat-bar__send" aria-label="Send message" disabled={!canSend}>{sending ? <LoaderCircle size={16} className="tt-spin" /> : <ArrowUp size={17} />}</button>
    </form>
  </div>;
}
