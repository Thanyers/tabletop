import { useEffect, useId, useLayoutEffect, useRef, useState, } from 'react';
import { ArrowUp, AtSign, ImagePlus, LoaderCircle, Paperclip, Plus, StickyNote, X } from 'lucide-react';
import { runCanvasObjectCommand, type ChatCardReference } from './canvas-object-finder';
import { consentKey, consentQuestion, needsConsent, rememberConsent, storedConsent, type TableChatConsentScope, type TableChatMode } from './table-chat-consent';
import { VISIBILITY_POLICY } from '../shared/visibility';
import './table-chat.css';

const MAX_MESSAGE_CHARS = 1200;
const MAX_ROWS = 5;

function referenceGroupLabel(references: readonly ChatCardReference[]): string {
  const hasRules = references.some((reference) => reference.rule);
  const hasCards = references.some((reference) => !reference.rule);
  if (hasRules && hasCards) return 'cards and rules';
  if (hasRules) return references.length === 1 ? 'rule' : 'rules';
  return references.length === 1 ? 'card' : 'cards';
}

/** F076: what the + menu can add besides a table file. */
export interface ComposerTools {
  /** Drops a sticky note on the canvas; absent when notes cannot be added. */
  onAddNote?: () => void;
  noteDisabledReason?: string;
  /** Pins the waiting pictures as image cards, the typed message as their caption. */
  onPinImages?: (images: readonly File[], caption: string) => Promise<void>;
  /** Pictures that can still be added to this table. */
  imagesLeft?: number;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_WAITING_IMAGES = 4;

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
  /** F076: the + menu's note and picture tools; pictures wait in the composer until sent. */
  composerTools?: ComposerTools;
  /** F067: bytes a rule request would carry for this table, shown while the next message is a rule request. */
  aiContext?: { used: number; limit: number };
  onMessageChange?: (message: string) => void;
  /** A card the next message is about, shown as a chip above the box. */
  /** Cards the next message is about; each chip can be removed on its own. */
  cardReferences?: readonly ChatCardReference[];
  onRemoveCardReference?: (id: string) => void;
  onClearCardReferences?: () => void;
}

/** One-line chat box fixed to the bottom centre of a shared table (F006). */
export function TableChat({
  workspaceId, epoch, actorId, mode, sourceFiles, placeholder, aiEnabled, canAttach, busy,
  acceptFiles, historyStatus = 'ready', onRetryHistory, prefill, acknowledged, focusKey = 0,
  explicitRuleEdit = false, onCancelRuleEdit, onAttach, onSend, onMessageChange, composerTools, aiContext,
  cardReferences = [], onRemoveCardReference, onClearCardReferences,
}: TableChatProps) {
  const [message, setMessage] = useState('');
  const [grantedKey, setGrantedKey] = useState<string | null>(() => storedConsent({ workspaceId, epoch, actorId }));
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [sendError, setSendError] = useState('');
  // Result of a card command typed in the chat (open, find or hide a card); nothing goes to the AI.
  const [objectNotice, setObjectNotice] = useState('');
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // F076: pictures chosen but not yet pinned; they stay here so the person can drop them or add a caption first.
  const [waitingImages, setWaitingImages] = useState<{ id: string; file: File; url: string }[]>([]);
  const [pinning, setPinning] = useState(false);
  const messageRef = useRef(message);
  messageRef.current = message;
  useEffect(() => { onMessageChange?.(message); }, [message, onMessageChange]);
  const appliedAcknowledgement = useRef<string | null>(null);
  const sendLock = useRef(false);
  const idPrefix = useId().replaceAll(':', '');
  const messageId = `tt-table-chat-message-${idPrefix}`;
  const scope: TableChatConsentScope = { workspaceId, epoch, actorId };
  const scopeKey = consentKey(scope);
  const trimmed = message.trim();
  const historyBlocked = mode === 'ask' && historyStatus !== 'ready';
  const controlsBusy = busy || sending || attaching || pinning;
  const pinningImages = waitingImages.length > 0;
  const canSend = pinningImages ? !controlsBusy : aiEnabled && !controlsBusy && !historyBlocked && trimmed.length >= 3;
  const imagesLeft = Math.max(0, (composerTools?.imagesLeft ?? MAX_WAITING_IMAGES) - waitingImages.length);
  const canAddImages = Boolean(composerTools?.onPinImages) && imagesLeft > 0 && waitingImages.length < MAX_WAITING_IMAGES;
  const hasMenu = canAttach || Boolean(composerTools?.onAddNote) || Boolean(composerTools?.onPinImages);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); };
  }, [menuOpen]);

  const waitingRef = useRef(waitingImages);
  waitingRef.current = waitingImages;
  useEffect(() => () => { for (const image of waitingRef.current) URL.revokeObjectURL(image.url); }, []);

  const queueImages = (files: readonly File[]) => {
    const accepted = files.filter((file) => IMAGE_TYPES.includes(file.type));
    if (accepted.length < files.length) setAttachmentError('Use a JPEG, PNG or WebP image.');
    else setAttachmentError('');
    const room = Math.min(imagesLeft, MAX_WAITING_IMAGES - waitingImages.length);
    if (accepted.length > room) setAttachmentError(room > 0 ? `You can add ${room} more image${room === 1 ? '' : 's'} here.` : 'This table cannot take more images.');
    const next = accepted.slice(0, Math.max(0, room)).map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    if (next.length) setWaitingImages((current) => [...current, ...next]);
    fieldRef.current?.focus();
  };

  const dropImage = (id: string) => {
    setWaitingImages((current) => current.filter((image) => {
      if (image.id === id) URL.revokeObjectURL(image.url);
      return image.id !== id;
    }));
    fieldRef.current?.focus();
  };

  const pinImages = async () => {
    const pin = composerTools?.onPinImages;
    if (!pin || sendLock.current || controlsBusy) return;
    sendLock.current = true;
    setPinning(true);
    setSendError('');
    const pinned = waitingImages;
    try {
      await pin(pinned.map((image) => image.file), trimmed);
      for (const image of pinned) URL.revokeObjectURL(image.url);
      setWaitingImages((current) => current.filter((image) => !pinned.includes(image)));
      setMessage('');
    } catch (error) {
      setSendError(error instanceof Error && error.message ? error.message : 'The images could not be added. They are still here.');
    } finally {
      sendLock.current = false;
      setPinning(false);
      fieldRef.current?.focus();
    }
  };

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
    // F076: with pictures waiting, Send pins them (the message becomes their caption); nothing goes to the AI.
    if (pinningImages) { void pinImages(); return; }
    if (trimmed.length > 0 && !controlsBusy) {
      const command = runCanvasObjectCommand(trimmed);
      if (command.handled) {
        setObjectNotice(command.message);
        setSendError('');
        setMessage('');
        return;
      }
    }
    setObjectNotice('');
    if (!canSend) return;
    // Another control (e.g. a clarifying-answer card) may have stored consent since mount.
    const granted = grantedKey ?? storedConsent(scope);
    if (granted !== grantedKey) setGrantedKey(granted);
    if (needsConsent(granted, scope)) setAsking(true);
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
    {historyStatus === 'loading' && mode === 'ask' && <p className="tt-table-chat-bar__status" role="status"><LoaderCircle size={13} className="tt-spin" />{VISIBILITY_POLICY === 'open' ? 'Loading table conversation…' : 'Loading private conversation…'}</p>}
    {historyStatus === 'error' && mode === 'ask' && <p className="tt-table-chat-bar__status is-error" role="alert">{VISIBILITY_POLICY === 'open' ? 'Table conversation history could not be loaded.' : 'Private conversation history could not be loaded.'} <button type="button" className="tt-table-chat-bar__retry" onClick={onRetryHistory}>Retry</button></p>}
    {attachmentError && <p className="tt-table-chat-bar__status is-error" role="alert">{attachmentError}</p>}
    {sendError && <p className="tt-table-chat-bar__status is-error" role="alert">{sendError}</p>}
    {objectNotice && <p className="tt-table-chat-bar__status" role="status">{objectNotice}</p>}
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
    {cardReferences.length > 0 && <div className="tt-table-chat-bar__reference" data-testid="chat-card-reference">
      <ul className="tt-table-chat-bar__reference-chips" aria-label="Items this message is about">
        {cardReferences.map((reference) => <li key={reference.id} className="tt-table-chat-bar__reference-chip" title={reference.detail}>
          <AtSign size={13} aria-hidden="true" /><span>{reference.title}</span>
          <button type="button" aria-label={`Stop referencing ${reference.rule ? 'rule' : 'card'} ${reference.title}`} onClick={() => { onRemoveCardReference?.(reference.id); fieldRef.current?.focus(); }}><X size={12} aria-hidden="true" /></button>
        </li>)}
      </ul>
      <small>{mode === 'draft'
        ? `Your message changes the selected ${referenceGroupLabel(cardReferences)}.`
        : `Your message is about the selected ${referenceGroupLabel(cardReferences)}. Add another with a chat button on the canvas.`}</small>
      {cardReferences.length > 1 && <button type="button" className="tt-table-chat-bar__reference-clear" aria-label="Stop referencing all selected items" onClick={() => { onClearCardReferences?.(); fieldRef.current?.focus(); }}><X size={13} aria-hidden="true" /></button>}
    </div>}
    {waitingImages.length > 0 && <div className="tt-table-chat-bar__images" data-testid="chat-waiting-images">
      <ul aria-label="Images waiting to be pinned">
        {waitingImages.map((image) => <li key={image.id}>
          <img src={image.url} alt={image.file.name} />
          <button type="button" aria-label={`Remove ${image.file.name}`} disabled={pinning} onClick={() => dropImage(image.id)}><X size={12} aria-hidden="true" /></button>
        </li>)}
      </ul>
      <small>{pinning ? 'Pinning…' : 'Type a caption if you like, then send to pin. Remove one to change your mind.'}</small>
    </div>}
    <form className="tt-table-chat-bar__box" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {hasMenu && <div className="tt-table-chat-bar__add" ref={menuRef}>
        <button type="button" className="tt-table-chat-bar__icon" aria-label="Add to this table" title="Add a file, note or image" aria-haspopup="menu" aria-expanded={menuOpen} disabled={controlsBusy} onClick={() => setMenuOpen((open) => !open)}><Plus size={18} aria-hidden="true" /></button>
        {menuOpen && <div className="tt-table-chat-bar__menu" role="menu" aria-label="Add to this table">
          {canAttach && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }}><Paperclip size={15} aria-hidden="true" /><span>Attach a file<small>{composerTools?.onPinImages ? 'CSV, JSON, text or an image' : 'CSV, JSON or text'}</small></span></button>}
          {composerTools?.onAddNote && <button type="button" role="menuitem" disabled={Boolean(composerTools.noteDisabledReason)} title={composerTools.noteDisabledReason} onClick={() => { setMenuOpen(false); composerTools.onAddNote?.(); }}><StickyNote size={15} aria-hidden="true" /><span>Add a note<small>{composerTools.noteDisabledReason ?? 'A sticky note on the canvas'}</small></span></button>}
          {composerTools?.onPinImages && <button type="button" role="menuitem" disabled={!canAddImages} onClick={() => { setMenuOpen(false); imageRef.current?.click(); }}><ImagePlus size={15} aria-hidden="true" /><span>Add an image<small>{canAddImages ? 'Shows here first; send to pin it' : 'This table cannot take more images'}</small></span></button>}
        </div>}
        {canAttach && <input ref={fileRef} type="file" hidden accept={composerTools?.onPinImages ? `${acceptFiles ?? ''},${IMAGE_TYPES.join(',')}` : acceptFiles} aria-label="Choose a file to attach" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!file) return;
          // F076: a picture picked through Attach waits in the composer like one from Add an image.
          if (composerTools?.onPinImages && IMAGE_TYPES.includes(file.type)) queueImages([file]);
          else void attach(file);
        }} />}
        {composerTools?.onPinImages && <input ref={imageRef} type="file" hidden multiple accept={IMAGE_TYPES.join(',')} aria-label="Choose images to add" onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          if (files.length) queueImages(files);
        }} />}
      </div>}
      {explicitRuleEdit && <button type="button" className="tt-table-chat-bar__cancel-edit" aria-label="Cancel rule edit" title="Cancel rule edit" disabled={controlsBusy} onClick={cancelRuleEdit}><X size={16} /></button>}
      <label className="tt-visually-hidden" htmlFor={messageId}>Message</label>
      {/* F021: keep the box editable while a draft or answer is pending so the next message can be written; send stays gated by canSend. */}
      <textarea id={messageId} ref={fieldRef} rows={1} value={message} maxLength={MAX_MESSAGE_CHARS} placeholder={pinningImages ? 'Add a caption (optional), then send to pin' : placeholder} aria-describedby={pinningImages ? `${messageId}-images` : busy ? `${messageId}-wait` : undefined}
        onChange={(event) => { setMessage(event.target.value); setAsking(false); setSendError(''); }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit();
        }} />
      {pinningImages && <span className="tt-visually-hidden" id={`${messageId}-images`}>Send pins the images on the canvas; the message becomes their caption.</span>}
      {busy && <span id={`${messageId}-wait`} className="tt-visually-hidden">You can keep typing. Send is available once the pending step on the table (a running command, an action proposal or an unconfirmed request) is resolved.</span>}
      <button type="submit" className="tt-table-chat-bar__send" aria-label={pinningImages ? 'Pin images' : 'Send message'} disabled={!canSend} title={busy ? 'Send is available once the pending step on the table is resolved' : undefined}>{sending ? <LoaderCircle size={16} className="tt-spin" /> : <ArrowUp size={17} />}</button>
    </form>
    {mode === 'draft' && aiContext && <AiContextMeter {...aiContext} />}
  </div>;
}

/** "AI context 41 / 128 KiB": how much of a rule request this table already fills (F067). */
function AiContextMeter({ used, limit }: { used: number; limit: number }) {
  const kib = (bytes: number) => Math.max(1, Math.round(bytes / 1024));
  const ratio = used / limit;
  const level = ratio > 1 ? 'over' : ratio > 0.8 ? 'high' : 'ok';
  return <p className="tt-table-chat-bar__context" data-level={level} data-testid="ai-context-meter"
    title="Your message, files the rules do not cite yet, the rules and every row go to the AI with each rule request. Files the rules already cite go by name only.">
    <span className="tt-table-chat-bar__context-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} /></span>
    AI context {kib(used)} / {kib(limit)} KiB
    {level === 'over' && <b> · too large to send. Remove a file or some rows.</b>}
    {level === 'high' && <b> · almost full</b>}
  </p>;
}
