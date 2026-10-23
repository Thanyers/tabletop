import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ImagePlus, LoaderCircle, StickyNote, Trash2 } from 'lucide-react';
import type { CanvasCardMeta, NoteColor, TableNote } from '../shared/table-contracts';
import type { WorkspaceView } from '../shared/contracts';
import type { Command } from './types';
import { MAX_NOTE_TEXT } from '../domain/table';
import { cardMetaDescription, formatRelative, useCardNow } from './canvas-card-meta';
import { MAX_TABLE_IMAGES, canvasImagePath } from '../shared/canvas-images';
import { acceptedImageFile, imageCardSize, prepareCanvasImage } from './canvas-image-prepare';
import './note-card.css';

const NOTE_COLORS: NoteColor[] = ['yellow', 'rose', 'sky', 'mint', 'lavender', 'sand'];
const MIN_WIDTH = 160;
const MIN_HEIGHT = 110;
const MAX_WIDTH = 480;
const MAX_HEIGHT = 560;

interface NoteCardProps {
  view: WorkspaceView;
  note: TableNote;
  busy: string | null;
  onCommand: Command;
  expanded?: boolean;
}

function authorName(view: WorkspaceView, actorId: string): string {
  return view.members.find((member) => member.actorId === actorId)?.name ?? 'Member';
}

/** F037: a shared sticky note. Everything here is local UI state until it is committed as a command. */
export function NoteCard({ view, note, busy, onCommand }: NoteCardProps) {
  const readOnly = busy === 'table.readOnly';
  const [draft, setDraft] = useState(note.text);
  const [size, setSize] = useState({ width: note.width, height: note.height });
  const [editing, setEditing] = useState(false);
  const savedRef = useRef(note.text);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (note.text !== savedRef.current && !editing) {
      savedRef.current = note.text;
      setDraft(note.text);
    }
  }, [note.text, editing]);

  useEffect(() => {
    setSize({ width: note.width, height: note.height });
  }, [note.width, note.height]);

  useEffect(() => () => { if (timerRef.current !== undefined) window.clearTimeout(timerRef.current); }, []);

  const commitText = useCallback((text: string) => {
    if (readOnly || text === savedRef.current) return;
    savedRef.current = text;
    void onCommand('table.updateNote', { noteId: note.id, text });
  }, [note.id, onCommand, readOnly]);

  const scheduleText = (text: string) => {
    setDraft(text);
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => commitText(text), 700);
  };

  const flushText = () => {
    if (timerRef.current !== undefined) { window.clearTimeout(timerRef.current); timerRef.current = undefined; }
    commitText(draft);
  };

  const recolor = (color: NoteColor) => {
    if (readOnly || color === note.color) return;
    void onCommand('table.updateNote', { noteId: note.id, color });
  };

  // F073: a picture is removed only by whoever pinned it or the table owner (the server checks this too).
  const isImage = Boolean(note.imageId);
  const canRemove = !isImage || note.createdBy === view.actor.actorId || view.actor.role === 'owner';
  const remove = () => {
    if (readOnly || !canRemove) return;
    void onCommand('table.removeNote', { noteId: note.id });
  };

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...size };
    let latest = { ...start };
    const move = (moveEvent: PointerEvent) => {
      latest = {
        width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(start.width + moveEvent.clientX - startX))),
        height: Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(start.height + moveEvent.clientY - startY))),
      };
      setSize(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      void onCommand('table.updateNote', { noteId: note.id, width: latest.width, height: latest.height });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const author = authorName(view, note.createdBy);
  // F054: the note's time lives in the footer line that already exists; no extra row, no extra icon.
  const now = useCardNow();
  const noteMeta: CanvasCardMeta = { createdAt: note.createdAt, updatedAt: note.updatedAt, createdBy: note.createdBy, origin: 'human', source: 'recorded' };
  return <div
    className={`tt-note tt-note--${note.color}${isImage ? ' tt-note--image' : ''}${editing ? ' is-editing' : ''}`}
    style={{ width: size.width, height: size.height }}
    data-note-id={note.id}
    role="group"
    aria-label={isImage ? `Image by ${author}` : `Note by ${author}`}
  >
    <span className="tt-note__drag" aria-hidden="true" />
    <div className="tt-note__tools nodrag">
      {NOTE_COLORS.map((color) => <button
        key={color}
        type="button"
        className={`tt-note__dot${color === note.color ? ' is-current' : ''}`}
        data-color={color}
        aria-label={`Colour ${color}`}
        aria-pressed={color === note.color}
        disabled={readOnly}
        onClick={() => recolor(color)}
      />)}
      <span className="tt-note__sep" aria-hidden="true" />
      {canRemove && <button type="button" className="tt-note__remove nodrag" aria-label={isImage ? 'Delete image' : 'Delete note'} disabled={readOnly} onClick={remove}>
        <Trash2 size={12} aria-hidden="true" /> Delete
      </button>}
    </div>

    {note.imageId && <img
      className="tt-note__image"
      src={canvasImagePath(view.id, note.imageId)}
      alt={note.text.trim() || `Image added by ${author}`}
      draggable={false}
      loading="lazy"
      decoding="async"
    />}

    <textarea
      className={`tt-note__text nodrag${isImage ? ' tt-note__caption' : ''}`}
      aria-label={isImage ? 'Image caption' : 'Note text'}
      value={draft}
      maxLength={MAX_NOTE_TEXT}
      readOnly={readOnly}
      placeholder={isImage ? 'Add a caption…' : 'Write something…'}
      onChange={(event) => scheduleText(event.currentTarget.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => { setEditing(false); flushText(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }}
    />

    <div className="tt-note__meta">
      <span className="tt-note__author" title={`Created by ${author}`}>
        <i aria-hidden="true">{author.slice(0, 1).toUpperCase()}</i>{author}
      </span>
      <span className="tt-note__meta-sep" aria-hidden="true">·</span>
      <span className="tt-note__meta-time" title={cardMetaDescription(noteMeta, { now, actorName: author })}>{formatRelative(Math.max(note.createdAt, note.updatedAt), now)}</span>
    </div>
    <span className="tt-note__grip nodrag" role="separator" aria-label="Resize note" onPointerDown={startResize} />
  </div>;
}

/** Where the next note or picture lands: right of the existing ones, level with the highest. */
function nextNoteSpot(notes: readonly TableNote[]): { x: number; y: number } {
  const rightmost = notes.reduce((max, note) => Math.max(max, note.x + note.width), 0);
  const top = notes.length ? Math.min(...notes.map((note) => note.y)) : 40;
  return { x: rightmost ? rightmost + 48 : 640, y: top };
}

/** F073: round button beside the note button; resizes a picture in the browser, uploads it, then pins it as a card. */
export function NewImageButton({ view, readOnly, onCommand, upload, onError }: {
  view: WorkspaceView;
  readOnly: boolean;
  onCommand: Command;
  upload: (image: Blob) => Promise<string>;
  onError: (message: string) => void;
}) {
  const notes = view.domain.kind === 'table' ? view.domain.notes ?? [] : [];
  const atLimit = notes.filter((note) => note.imageId).length >= MAX_TABLE_IMAGES;
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const add = async (file: File) => {
    if (!acceptedImageFile(file)) { onError('Use a JPEG, PNG or WebP image.'); return; }
    setWorking(true);
    try {
      const prepared = await prepareCanvasImage(file);
      const imageId = await upload(prepared.blob);
      await onCommand('table.addNote', { ...nextNoteSpot(notes), ...imageCardSize(prepared.width, prepared.height), imageId });
    } catch (error) {
      onError(error instanceof Error ? error.message : 'The image could not be added.');
    } finally {
      setWorking(false);
    }
  };
  return <>
    <button
      type="button"
      className="tt-note-add"
      aria-label={atLimit ? 'Image limit reached' : 'Add an image'}
      title={atLimit ? `This table already has ${MAX_TABLE_IMAGES} images` : 'Add an image'}
      aria-busy={working || undefined}
      disabled={readOnly || atLimit || working}
      onClick={() => inputRef.current?.click()}
    >
      {working ? <LoaderCircle size={18} className="tt-spin" aria-hidden="true" /> : <ImagePlus size={18} aria-hidden="true" />}
    </button>
    <input ref={inputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="Choose an image to add" onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void add(file);
    }} />
  </>;
}

/** Round button that sits beside the chat composer and drops a note on the canvas. */
export function NewNoteButton({ view, readOnly, onCommand }: { view: WorkspaceView; readOnly: boolean; onCommand: Command }) {
  const notes = view.domain.kind === 'table' ? view.domain.notes ?? [] : [];
  // F073: pictures have their own allowance; only text notes count here.
  const atLimit = notes.filter((note) => !note.imageId).length >= 20;
  const place = () => {
    if (readOnly || atLimit) return;
    void onCommand('table.addNote', nextNoteSpot(notes));
  };
  return <button
    type="button"
    className="tt-note-add"
    aria-label={atLimit ? 'Note limit reached' : 'Add note'}
    title={atLimit ? 'This table already has 20 notes' : 'New note'}
    disabled={readOnly || atLimit}
    onClick={place}
  >
    <StickyNote size={18} aria-hidden="true" />
  </button>;
}
