import { useEffect, useRef } from 'react';
import { ChevronDown, DoorOpen, KeyRound, Plus, X } from 'lucide-react';

/**
 * F080: the room actions live in the table header, beside Invite.
 *
 * They used to be two pill toggles stacked between the header and the canvas, which pushed the table
 * down and read as loose controls. A header menu keeps them one click away, and each opens its form in
 * a dialog so the canvas never moves.
 */

export type RoomAction = 'create' | 'grant';

export function RoomMenu({ onChoose }: { onChoose: (action: RoomAction) => void }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const choose = (action: RoomAction) => {
    if (menuRef.current) menuRef.current.open = false;
    onChoose(action);
  };
  return (
    <details ref={menuRef} className="tt-table-options tt-room-menu">
      <summary className="tt-button tt-button--quiet tt-room-menu__button" aria-label="ห้อง: สร้างห้องหรือให้ห้องอ่านข้อมูล">
        <DoorOpen size={15} /><span>ห้อง</span><ChevronDown size={14} />
      </summary>
      <div className="tt-table-options__body tt-room-menu__body">
        <button type="button" onClick={() => choose('create')}>
          <Plus size={15} /><span><strong>สร้างห้องจากโต๊ะนี้</strong><small>เปิดห้องให้หลายโต๊ะทำงานด้วยกัน</small></span>
        </button>
        <button type="button" onClick={() => choose('grant')}>
          <KeyRound size={15} /><span><strong>ให้ห้องอ่านข้อมูลจากโต๊ะนี้</strong><small>เลือกห้องและฟิลด์ที่ยอมให้เห็น</small></span>
        </button>
      </div>
    </details>
  );
}

/** A plain dialog shell for one room form; the form inside keeps its own heading. */
export function RoomDialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => { window.clearTimeout(timer); previous?.focus(); };
  }, []);
  return (
    <div className="tt-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="tt-dialog tt-room-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
        <button ref={closeRef} type="button" className="tt-room-dialog__close" aria-label="ปิด" onClick={onClose}><X size={16} /></button>
        {children}
      </section>
    </div>
  );
}
