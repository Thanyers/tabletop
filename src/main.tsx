import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/700.css';
import '@xyflow/react/dist/style.css';
import { UpdateNotice } from './update-notice/UpdateNotice';
import { LoadingScreen } from './loading/LoadingScreen';
// One `lazy(() => import(…))` per route: a single factory choosing between several
// dynamic imports makes Rollup attach one preload list to the whole call, so a
// route can load its JS without its CSS (F079).
const path = location.pathname;
const Experience = path === '/demo' || path === '/demo/'
  ? lazy(() => import('./tabletop/demo/InteractiveDemo'))
  : path === '/demo/replay' || path === '/demo/replay/'
    ? lazy(() => import('./tabletop/demo/PublicDemo'))
    : lazy(() => import('./tabletop/TabletopApp'));
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<LoadingScreen />}><Experience/></Suspense><UpdateNotice/></React.StrictMode>);
