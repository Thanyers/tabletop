import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ViewportPortal, useViewport } from '@xyflow/react';
import { cursorColor, type CursorRelay } from '../shared/cursor-protocol';
import type { Member } from '../shared/contracts';
import './live-cursors.css';

/** Hide a cursor that has not moved for this long (the sender may be idle or gone). */
const CURSOR_IDLE_MS = 10_000;

type Point = { x: number; y: number; at: number };

/** Cursor frames arrive ~25 Hz per person; keep them out of React state so only the overlay re-renders. */
export function createCursorStore() {
  let points: Record<string, Point> = {};
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    get: () => points,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    apply(relay: CursorRelay) {
      const next = { ...points };
      if ('leave' in relay) delete next[relay.actorId];
      else next[relay.actorId] = { x: relay.x, y: relay.y, at: Date.now() };
      points = next; emit();
    },
    clear() { if (Object.keys(points).length) { points = {}; emit(); } },
  };
}
export type CursorStore = ReturnType<typeof createCursorStore>;

interface LiveCursorValue { store: CursorStore; send: (point: { x: number; y: number } | null) => void }
const LiveCursorContext = createContext<LiveCursorValue | null>(null);

export function LiveCursorProvider({ value, children }: { value: LiveCursorValue | null; children: ReactNode }) {
  return <LiveCursorContext.Provider value={value}>{children}</LiveCursorContext.Provider>;
}

export function useLiveCursorSender(): LiveCursorValue['send'] | null {
  return useContext(LiveCursorContext)?.send ?? null;
}

/** Other people's pointers, drawn in canvas coordinates inside React Flow's viewport. */
export function LiveCursors({ members, selfId }: { members: readonly Member[]; selfId: string }) {
  const live = useContext(LiveCursorContext);
  const empty = useState(() => createCursorStore())[0];
  const store = live?.store ?? empty;
  const points = useSyncExternalStore(store.subscribe, store.get, store.get);
  const { zoom } = useViewport();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 2_000); return () => window.clearInterval(timer); }, []);
  const names = new Map(members.map((member) => [member.actorId, member.name]));
  const visible = Object.entries(points).filter(([actorId, point]) => actorId !== selfId && names.has(actorId) && now - point.at < CURSOR_IDLE_MS);
  if (!visible.length) return null;
  return <ViewportPortal>
    {visible.map(([actorId, point]) => {
      const color = cursorColor(actorId);
      return <div key={actorId} className="tt-live-cursor" data-testid="live-cursor" data-actor-id={actorId}
        style={{ transform: `translate(${point.x}px, ${point.y}px) scale(${1 / zoom})`, ['--tt-cursor-color' as string]: color }}>
        <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M1 1 L1 16 L5.5 12 L8.5 19 L11 18 L8 11 L14 11 Z" fill={color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        <span className="tt-live-cursor__name">{names.get(actorId)}</span>
      </div>;
    })}
  </ViewportPortal>;
}
