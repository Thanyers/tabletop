import { AlertCircle, ArrowRight, ChevronDown, LogOut, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AdminWorkspace, AdminWorkspacePage, AuthStatus, GoogleAuthUser } from '../client';
import { loadAnalytics } from '../../analytics';
import './account.css';
import { PublicWelcome } from './PublicWelcome';

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
  // F072: only signed-out visitors on `/` are measured; loadAnalytics checks the path and host itself.
  useEffect(() => { loadAnalytics(); }, []);
  return <PublicWelcome>{(copy) => <section id="sign-in" className="tt-public-welcome__auth" aria-labelledby="tt-public-welcome-auth-title">
    <span className="tt-account-gate__eyebrow"><ShieldCheck size={14} /> {copy.auth.eyebrow}</span>
    <h2 id="tt-public-welcome-auth-title">{copy.auth.title}</h2>
    <p className="tt-public-welcome__auth-copy">{copy.auth.body}</p>
    {hasPendingInvite && <p className="tt-account-gate__invite" role="status"><ShieldCheck size={15} /> {copy.auth.inviteSaved}</p>}
    {notice && <div className={`tt-account-gate__notice tt-account-gate__notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><AlertCircle size={15} /><span lang="en">{notice.text}</span><button type="button" aria-label={copy.auth.dismiss} onClick={onDismissNotice}>×</button></div>}
    <a className="tt-account-gate__google" href={status.loginUrl}>
      <span className="tt-account-gate__google-mark" aria-hidden="true">G</span>
      <span>{copy.auth.google}</span>
      <ArrowRight size={16} />
    </a>
    <button className="tt-account-gate__retry" type="button" onClick={onRetry} disabled={checking}>
      <RefreshCw size={13} className={checking ? 'tt-account-gate__spin' : ''} />
      {checking ? copy.auth.checking : copy.auth.checkAgain}
    </button>
    <details className="tt-public-welcome__invite-details">
      <summary>{copy.auth.inviteHelpTitle}</summary>
      <p>{copy.auth.inviteHelp}</p>
    </details>
    <a className="tt-account-gate__demo" href="/demo" target="_blank" rel="noopener" aria-label={copy.auth.demoLabel}><span>{copy.auth.demo}</span><small>{copy.auth.demoHint}</small><ArrowRight size={14} /></a>
  </section>}</PublicWelcome>;
}

/** The public landing for someone already signed in: same story, with a way back to their tables instead of sign-in. */
export function SignedInWelcome({ user, onOpenTables, onStart }: { user: GoogleAuthUser | null; onOpenTables: () => void; onStart: () => void }) {
  const openTables = (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); onOpenTables(); };
  return <PublicWelcome headerAction={(copy) => <a className="tt-public-welcome__signin" href="/tables" onClick={openTables}>{copy.header.yourTables} <ArrowRight size={14} aria-hidden="true" /></a>}>{(copy) => <section id="sign-in" className="tt-public-welcome__auth" aria-labelledby="tt-public-welcome-auth-title">
    <span className="tt-account-gate__eyebrow"><ShieldCheck size={14} /> {copy.welcome.eyebrow}</span>
    <h2 id="tt-public-welcome-auth-title">{copy.welcome.title(user?.name ?? null)}</h2>
    <p className="tt-public-welcome__auth-copy">{copy.welcome.body}</p>
    <a className="tt-account-gate__google" href="/tables" onClick={openTables}>
      <span>{copy.header.yourTables}</span>
      <ArrowRight size={16} />
    </a>
    <button className="tt-account-gate__retry" type="button" onClick={onStart}>{copy.welcome.start}</button>
    <a className="tt-account-gate__demo" href="/demo" target="_blank" rel="noopener" aria-label={copy.auth.demoLabel}><span>{copy.auth.demo}</span><small>{copy.auth.demoHint}</small><ArrowRight size={14} /></a>
  </section>}</PublicWelcome>;
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
