import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { StickyNote, Trash2 } from 'lucide-react';
import type { NoteColor, TableNote } from '../shared/table-contracts';
import type { WorkspaceView } from '../shared/contracts';
import type { Command } from './types';
import { MAX_NOTE_TEXT } from '../domain/table';
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

  const remove = () => {
    if (readOnly) return;
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
  return <div
    className={`tt-note tt-note--${note.color}${editing ? ' is-editing' : ''}`}
    style={{ width: size.width, height: size.height }}
    data-note-id={note.id}
    role="group"
    aria-label={`Note by ${author}`}
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
      <button type="button" className="tt-note__remove nodrag" aria-label="Delete note" disabled={readOnly} onClick={remove}>
        <Trash2 size={12} aria-hidden="true" /> Delete
      </button>
    </div>

    <textarea
      className="tt-note__text nodrag"
      aria-label="Note text"
      value={draft}
      maxLength={MAX_NOTE_TEXT}
      readOnly={readOnly}
      placeholder="Write something…"
      onChange={(event) => scheduleText(event.currentTarget.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => { setEditing(false); flushText(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }}
    />

    <div className="tt-note__meta">
      <span className="tt-note__author" title={`Created by ${author}`}>
        <i aria-hidden="true">{author.slice(0, 1).toUpperCase()}</i>{author}
      </span>
    </div>
    <span className="tt-note__grip nodrag" role="separator" aria-label="Resize note" onPointerDown={startResize} />
  </div>;
}

/** Round button that sits beside the chat composer and drops a note on the canvas. */
export function NewNoteButton({ view, readOnly, onCommand }: { view: WorkspaceView; readOnly: boolean; onCommand: Command }) {
  const notes = view.domain.kind === 'table' ? view.domain.notes ?? [] : [];
  const atLimit = notes.length >= 20;
  const place = () => {
    if (readOnly || atLimit) return;
    const rightmost = notes.reduce((max, note) => Math.max(max, note.x + note.width), 0);
    const top = notes.length ? Math.min(...notes.map((note) => note.y)) : 40;
    void onCommand('table.addNote', { x: rightmost ? rightmost + 48 : 640, y: top });
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
