import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Trash2 } from 'lucide-react';
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

/** F076: why a text note cannot be added right now, or nothing when it can. */
export function noteLimitReason(view: WorkspaceView): string | undefined {
  const notes = view.domain.kind === 'table' ? view.domain.notes ?? [] : [];
  return notes.filter((note) => !note.imageId).length >= 20 ? 'This table already has 20 notes' : undefined;
}

/** F076: pictures this table can still take. */
export function imagesLeft(view: WorkspaceView): number {
  const notes = view.domain.kind === 'table' ? view.domain.notes ?? [] : [];
  return Math.max(0, MAX_TABLE_IMAGES - notes.filter((note) => note.imageId).length);
}

/** F037: drop an empty sticky note right of the existing ones. */
export function addNote(view: WorkspaceView, onCommand: Command): void {
  if (noteLimitReason(view)) return;
  void onCommand('table.addNote', nextNoteSpot(view.domain.kind === 'table' ? view.domain.notes ?? [] : []));
}

/**
 * F073/F076: resize each picture in the browser, upload it, then pin it as an image card; the caption goes on
 * every card. Cards sit side by side so a batch never lands on one spot.
 */
export async function pinImages(view: WorkspaceView, files: readonly File[], caption: string, onCommand: Command, upload: (image: Blob) => Promise<string>): Promise<void> {
  const notes = view.domain.kind === 'table' ? view.domain.notes ?? [] : [];
  const spot = nextNoteSpot(notes);
  let x = spot.x;
  for (const file of files) {
    if (!acceptedImageFile(file)) throw new Error('Use a JPEG, PNG or WebP image.');
    const prepared = await prepareCanvasImage(file);
    const imageId = await upload(prepared.blob);
    const size = imageCardSize(prepared.width, prepared.height);
    const pinned = await onCommand('table.addNote', { x, y: spot.y, ...size, imageId, ...(caption ? { text: caption.slice(0, MAX_NOTE_TEXT) } : {}) });
    if (!pinned) throw new Error('The image could not be pinned. It is still in the chat box.');
    x += size.width + 32;
  }
}
