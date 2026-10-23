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
import { loadAnalytics } from './analytics';
const Experience = lazy(() => {
  const path = location.pathname;
  if (path === '/demo' || path === '/demo/') return import('./tabletop/demo/InteractiveDemo');
  if (path === '/demo/replay' || path === '/demo/replay/') return import('./tabletop/demo/PublicDemo');
  return new URLSearchParams(location.search).get('legacy-demo') === '1' ? import('./LegacyEntry') : import('./tabletop/TabletopApp');
});
// The demos are public pages; signed-out `/` loads analytics from the sign-in landing (F072).
if (location.pathname.startsWith('/demo')) loadAnalytics();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<LoadingScreen />}><Experience/></Suspense><UpdateNotice/></React.StrictMode>);
