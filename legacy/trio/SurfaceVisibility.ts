import { createContext } from 'react';

// Hidden but mounted tools retain their state, but must not keep playing media.
export const SurfaceVisibility = createContext(true);
