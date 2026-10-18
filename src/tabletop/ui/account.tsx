import { AlertCircle, ArrowRight, ChevronDown, LogOut, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AdminWorkspace, AdminWorkspacePage, AuthStatus, GoogleAuthUser } from '../client';
import './account.css';

type GoogleAuthStatus = Extract<AuthStatus, { mode: 'google' }>;
type Notice = { text: string; tone: 'info' | 'error' | 'success' } | null;

export function AccountSignIn({ status, notice, hasPendingInvite, checking, onRetry, onDismissNotice }: {
  status: GoogleAuthStatus;
  notice: Notice;
  hasPendingInvite: boolean;
  checking: boolean;
  onRetry: () => void;
  onDismissNotice: () => void;
}) {
  return <main className="tt-account-gate">
    <section className="tt-account-gate__card" aria-labelledby="tt-account-gate-title">
      <a className="tt-brand" href="/" aria-label="Tabletop"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></a>
      <span className="tt-account-gate__eyebrow"><ShieldCheck size={14} /> TABLE ACCESS</span>
      <h1 id="tt-account-gate-title">Sign in to open your tables</h1>
      <p className="tt-account-gate__copy">Sign in with Google to open your tables. An invitation link grants its designated seat to whoever opens it while it is valid; it is not tied to a preselected email.</p>
      {hasPendingInvite && <p className="tt-account-gate__invite"><ShieldCheck size={15} /> Your invitation is saved in this tab and will be used after sign-in.</p>}
      {notice && <div className={`tt-account-gate__notice tt-account-gate__notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><AlertCircle size={15} /><span>{notice.text}</span><button type="button" aria-label="Dismiss message" onClick={onDismissNotice}>×</button></div>}
      <a className="tt-account-gate__google" href={status.loginUrl}>
        <span className="tt-account-gate__google-mark" aria-hidden="true">G</span>
        <span>Continue with Google</span>
        <ArrowRight size={16} />
      </a>
      <button className="tt-account-gate__retry" type="button" onClick={onRetry} disabled={checking}>
        <RefreshCw size={13} className={checking ? 'tt-account-gate__spin' : ''} />
        {checking ? 'Checking sign-in…' : 'Already signed in? Check again'}
      </button>
      <p className="tt-account-gate__privacy">Table access is checked for every workspace. Invitation links are single-use and expire.</p>
    </section>
  </main>;
}

export function AccountBadge({ user, busy, onSignOut, onLoadAdminWorkspaces }: { user: GoogleAuthUser; busy: boolean; onSignOut: () => void; onLoadAdminWorkspaces?: (after?: string) => Promise<AdminWorkspacePage> }) {
  const [adminOpen, setAdminOpen] = useState(false);
  return <div className="tt-account-tools" aria-label={`Signed in as ${user.name}`}>
    {user.isAdmin && onLoadAdminWorkspaces && <button type="button" className="tt-account-admin-trigger" onClick={() => setAdminOpen(true)}><ShieldCheck size={13} /><span>Admin</span></button>}
    <span className="tt-account-badge__identity" title={user.email}>
      <strong>{user.name}</strong>
      <small>{user.email}</small>
    </span>
    <button type="button" className="tt-account-badge__signout" onClick={onSignOut} disabled={busy} aria-label={busy ? 'Signing out of Google account' : 'Sign out of Google account'}>
      <LogOut size={13} /><span>{busy ? 'Signing out…' : 'Sign out'}</span>
    </button>
    {adminOpen && <AdminMetadataDialog onLoad={onLoadAdminWorkspaces!} onClose={() => setAdminOpen(false)} />}
  </div>;
}

function AdminMetadataDialog({ onLoad, onClose }: { onLoad: (after?: string) => Promise<AdminWorkspacePage>; onClose: () => void }) {
  const [rows, setRows] = useState<AdminWorkspace[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const load = async (after?: string) => {
    if (after) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const page = await onLoad(after);
      setRows((current) => after ? [...current, ...page.workspaces] : page.workspaces);
      setNext(page.next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Workspace metadata could not be loaded.');
    } finally { setLoading(false); setLoadingMore(false); }
  };

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    void load();
    return () => { window.clearTimeout(timer); previousFocusRef.current?.focus(); };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? []);
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return createPortal(<div className="tt-admin-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="tt-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="tt-admin-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <header><div><span className="tt-account-gate__eyebrow"><ShieldCheck size={14} /> ACCOUNT ADMIN</span><h2 id="tt-admin-title">Table metadata</h2></div><button ref={closeRef} className="tt-admin-close" type="button" onClick={onClose} aria-label="Close admin panel"><X size={16} /></button></header>
      <p className="tt-admin-intro">This view lists account-level table metadata only. It does not provide access to table contents or private notes.</p>
      {error && <div className="tt-account-gate__notice tt-account-gate__notice--error" role="alert"><AlertCircle size={15} /><span>{error}</span><button type="button" onClick={() => void load()} aria-label="Retry loading table metadata"><RefreshCw size={13} /></button></div>}
      {loading ? <p className="tt-admin-loading" role="status"><RefreshCw size={14} className="tt-account-gate__spin" /> Loading table metadata…</p> : rows.length === 0 && !error ? <p className="tt-admin-empty">No tables are available.</p> : <div className="tt-admin-list" aria-label="Workspace metadata">
        {rows.map((row) => <article className="tt-admin-row" key={row.id}>
          <div className="tt-admin-row__head"><strong>{row.kind}</strong><span className={`tt-admin-status tt-admin-status--${row.status}`}>{row.status}</span></div>
          <dl><div><dt>Table ID</dt><dd title={row.id}>{row.id}</dd></div><div><dt>Created</dt><dd>{formatDate(row.createdAt)}</dd></div><div><dt>Owner ID</dt><dd title={row.ownerId}>{row.ownerId}</dd></div><div><dt>Members</dt><dd>{row.memberCount}</dd></div></dl>
        </article>)}
      </div>}
      {loadingMore && <p className="tt-admin-loading" role="status"><RefreshCw size={14} className="tt-account-gate__spin" /> Loading more…</p>}
      <footer><span>{rows.length} table{rows.length === 1 ? '' : 's'} shown</span>{next && <button type="button" className="tt-account-admin-trigger" disabled={loadingMore} onClick={() => void load(next)}><ChevronDown size={14} /> Load more</button>}<button type="button" className="tt-account-admin-trigger" onClick={onClose}>Close</button></footer>
    </section>
  </div>, document.body);
}

function formatDate(value: string | number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}
