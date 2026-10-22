import { useState } from 'react';
import './loading-screen.css';

/** Length of one full loop; the tile pulse (half of it) repeats inside it. */
const LOOP_MS = 2400;

/**
 * The full-screen loader shown while the app chunk downloads and while the
 * session is checked. Both stages mount their own copy, so each one starts its
 * animation at the page clock's position in the loop and the hand-over between
 * them does not jump back to frame zero.
 */
export function LoadingScreen({ label = 'Opening your table' }: { label?: string }) {
  const [offset] = useState(() => -(performance.now() % LOOP_MS));
  return <main className="tt-loading" role="status" aria-live="polite" aria-label={label} style={{ ['--tt-loading-offset' as string]: `${offset}ms` }}>
    <span className="tt-loading__mark" aria-hidden="true"><i /><i /><i /><i /></span>
  </main>;
}
