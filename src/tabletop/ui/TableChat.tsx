import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, LoaderCircle, Paperclip } from 'lucide-react';
import { consentKey, consentQuestion, needsConsent } from './table-chat-consent';
import './table-chat.css';

const MAX_MESSAGE_CHARS = 1200;
const MAX_ROWS = 5;

export interface TableChatProps {
  /** Source file ids that a request would send; consent covers exactly this set. */
  sourceIds: readonly string[];
  placeholder: string;
  aiEnabled: boolean;
  canAttach: boolean;
  busy: boolean;
  acceptFiles?: string;
  /** Sending also shares the table's current data (asking the table, not drafting). */
  sharesTable?: boolean;
  /** Text to place in the box, e.g. a description typed on the start page. */
  prefill?: { text: string; key: number };
  onAttach: (file: File) => Promise<void>;
  /** Resolves true when the message was accepted, so the box can clear. */
  onSend: (message: string) => Promise<boolean>;
}

/** One-line chat box fixed to the bottom centre of a shared table (F006). */
export function TableChat({ sourceIds, placeholder, aiEnabled, canAttach, busy, acceptFiles, sharesTable = false, prefill, onAttach, onSend }: TableChatProps) {
  const [message, setMessage] = useState('');
  const [grantedKey, setGrantedKey] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const trimmed = message.trim();
  const canSend = aiEnabled && !busy && !sending && trimmed.length > 0;

  useEffect(() => {
    if (prefill) setMessage(prefill.text.slice(0, MAX_MESSAGE_CHARS));
  }, [prefill]);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight) || 22;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, lineHeight * MAX_ROWS)}px`;
  }, [message]);

  const send = async () => {
    setAsking(false);
    setSending(true);
    try {
      const accepted = await onSend(trimmed);
      if (accepted) setMessage('');
    } finally {
      setSending(false);
      fieldRef.current?.focus();
    }
  };

  const submit = () => {
    if (!canSend) return;
    if (needsConsent(grantedKey, sourceIds)) setAsking(true);
    else void send();
  };

  return <div className="tt-table-chat-bar" data-testid="table-chat-bar">
    {asking && <div className="tt-table-chat-bar__consent" role="alertdialog" aria-label="Send to AI">
      <span>{consentQuestion(sourceIds.length, sharesTable)}</span>
      <button type="button" className="tt-table-chat-bar__consent-yes" onClick={() => { setGrantedKey(consentKey(sourceIds)); void send(); }}>Send</button>
      <button type="button" className="tt-table-chat-bar__consent-no" onClick={() => { setAsking(false); fieldRef.current?.focus(); }}>Cancel</button>
    </div>}
    <form className="tt-table-chat-bar__box" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {canAttach && <>
        <button type="button" className="tt-table-chat-bar__icon" aria-label="Attach a file" disabled={busy || sending} onClick={() => fileRef.current?.click()}><Paperclip size={17} /></button>
        <input ref={fileRef} type="file" hidden accept={acceptFiles} aria-label="Choose a file to attach" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void onAttach(file);
        }} />
      </>}
      <label className="tt-visually-hidden" htmlFor="tt-table-chat-message">Message</label>
      <textarea id="tt-table-chat-message" ref={fieldRef} rows={1} value={message} maxLength={MAX_MESSAGE_CHARS} placeholder={placeholder}
        onChange={(event) => { setMessage(event.target.value); setAsking(false); }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit();
        }} />
      <button type="submit" className="tt-table-chat-bar__send" aria-label="Send message" disabled={!canSend}>{sending ? <LoaderCircle size={16} className="tt-spin" /> : <ArrowUp size={17} />}</button>
    </form>
  </div>;
}
