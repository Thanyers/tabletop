import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Users } from 'lucide-react';
import type { Member } from '../shared/contracts';
import { cursorColor } from '../shared/cursor-protocol';
import { focusCanvasPoint } from './canvas-object-finder';
import { initials } from './initials';
import type { CursorStore } from './live-cursors';

/** Same idle window as the canvas overlay: an older cursor is treated as away. */
const LIVE_MS = 10_000;


function Avatar({ member }: { member: Member }) {
  return <span className="tt-header-avatar" style={{ ['--tt-avatar-color' as string]: cursorColor(member.actorId) }} aria-hidden="true">{initials(member.name)}</span>;
}

/**
 * Header people: avatars of everyone at the table. With one other person, clicking jumps to their live cursor;
 * with more, a list opens. People who are not moving a cursor right now show as away.
 */
export function HeaderPeople({ members, selfId, store, onOpenPeople }: { members: readonly Member[]; selfId: string; store: CursorStore; onOpenPeople: () => void }) {
  const points = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 2_000); return () => window.clearInterval(timer); }, []);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  const others = members.filter((member) => member.actorId !== selfId);
  const self = members.find((member) => member.actorId === selfId);
  const liveAt = (actorId: string) => {
    const point = points[actorId];
    return point && now - point.at < LIVE_MS ? point : null;
  };
  const goTo = (member: Member) => {
    const point = liveAt(member.actorId);
    if (point && focusCanvasPoint(point.x, point.y)) {
      setMessage('');
      setOpen(false);
      return;
    }
    setMessage(`${member.name} is not moving a cursor on the canvas right now.`);
    setOpen(true);
  };
  const shown = [...others, ...(self ? [self] : [])].slice(0, 3);
  const single = others.length === 1 ? others[0] : null;

  return <div className="tt-header-people" ref={rootRef}>
    <button type="button" className="tt-people-button tt-header-people__button" aria-expanded={single ? undefined : open} aria-haspopup={single ? undefined : 'menu'}
      aria-label={single ? `Go to ${single.name}’s cursor` : `People at this table, ${members.length}`}
      title={single ? `Go to ${single.name}’s cursor` : 'People at this table'}
      onClick={() => { if (single) goTo(single); else { setMessage(''); setOpen((value) => !value); } }}>
      {shown.length === 0 ? <Users size={16} /> : <span className="tt-header-avatars">{shown.map((member) => <span key={member.actorId} className={liveAt(member.actorId) && member.actorId !== selfId ? 'is-live' : undefined}><Avatar member={member} /></span>)}</span>}
      {members.length > 3 && <span className="tt-header-people__more">+{members.length - 3}</span>}
    </button>
    {open && <div className="tt-header-people__menu" role="menu" aria-label="People at this table">
      {message && <p className="tt-header-people__note" role="status">{message}</p>}
      {others.map((member) => {
        const live = Boolean(liveAt(member.actorId));
        return <button type="button" role="menuitem" key={member.actorId} onClick={() => goTo(member)}>
          <Avatar member={member} />
          <span><strong>{member.name}</strong><small>{live ? 'On the canvas · go to cursor' : 'Away'}</small></span>
          <i className={live ? 'is-live' : undefined} aria-hidden="true" />
        </button>;
      })}
      {self && <div className="tt-header-people__self"><Avatar member={self} /><span><strong>{self.name}</strong><small>You</small></span></div>}
      <button type="button" role="menuitem" className="tt-header-people__all" onClick={() => { setOpen(false); onOpenPeople(); }}>Open People card</button>
    </div>}
  </div>;
}
