import { createContext, useContext, type ReactNode } from 'react';

const PracticeClockContext = createContext<number | null>(null);

export function PracticeClockProvider({ now, children }: { now: number; children: ReactNode }) {
  return <PracticeClockContext.Provider value={now}>{children}</PracticeClockContext.Provider>;
}

export function usePracticeClock(): number | null {
  return useContext(PracticeClockContext);
}
