import { useEffect, useState } from 'react';
import { type BuildIdentity, fetchServedBuild, isDifferentBuild, runningBuild, VERSION_CHECK_INTERVAL_MS, versionLabel } from './version-check';
import './update-notice.css';

/** Tells people with an open tab that a new release is live and offers a refresh. */
export function UpdateNotice() {
  const [available, setAvailable] = useState<BuildIdentity | null>(null);
  const [dismissedSha, setDismissedSha] = useState<string | null>(null);

  useEffect(() => {
    const running = runningBuild();
    if (!running) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      const served = await fetchServedBuild();
      if (!stopped && served && isDifferentBuild(running, served)) setAvailable(served);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = window.setInterval(() => void check(), VERSION_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);

  if (!available || dismissedSha === `${available.version}/${available.sha}`) return null;
  const label = versionLabel(available);
  return (
    <div className="tt-update-notice" role="status" aria-live="polite" data-testid="update-notice">
      <span className="tt-update-notice-text">
        <strong>มีเวอร์ชันใหม่{label ? ` (${label})` : ''}</strong> รีเฟรชหน้าเพื่อใช้รุ่นล่าสุด
      </span>
      <button type="button" className="tt-update-notice-primary" onClick={() => window.location.reload()}>รีเฟรช</button>
      <button type="button" className="tt-update-notice-later" onClick={() => setDismissedSha(`${available.version}/${available.sha}`)}>ไว้ทีหลัง</button>
    </div>
  );
}
