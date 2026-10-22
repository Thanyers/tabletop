import { AlertCircle, ArrowRight, ChevronDown, Languages, LayoutGrid, LogOut, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AdminWorkspace, AdminWorkspacePage, AuthStatus, GoogleAuthUser } from '../client';
import './account.css';
import { cursorColor } from '../shared/cursor-protocol';
import { initials } from './initials';
import { LandingLanguageSwitchContext, useLandingCopy } from './landing-copy';
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
  return <PublicWelcome closingAction={<GoogleButton href={status.loginUrl} />}>
    <SignInPanel status={status} notice={notice} hasPendingInvite={hasPendingInvite} checking={checking} onRetry={onRetry} onDismissNotice={onDismissNotice} />
  </PublicWelcome>;
}

function GoogleButton({ href }: { href: string }) {
  const copy = useLandingCopy();
  return <a className="tt-account-gate__google" href={href}>
    <span className="tt-account-gate__google-mark" aria-hidden="true">G</span>
    <span>{copy.auth.google}</span>
    <ArrowRight size={16} />
  </a>;
}

function DemoLink() {
  const copy = useLandingCopy();
  return <a className="tt-account-gate__demo" href="/demo" target="_blank" rel="noopener" aria-label={copy.auth.demoLabel}><span>{copy.auth.demo}</span><small>{copy.auth.demoHint}</small><ArrowRight size={14} /></a>;
}

function SignInPanel({ status, notice, hasPendingInvite, checking, onRetry, onDismissNotice }: Parameters<typeof AccountSignIn>[0]) {
  const copy = useLandingCopy();
  return <section id="sign-in" className="tt-public-welcome__auth" aria-labelledby="tt-public-welcome-auth-title">
    <span className="tt-account-gate__eyebrow"><ShieldCheck size={14} /> {copy.auth.eyebrow}</span>
    <h2 id="tt-public-welcome-auth-title">{copy.auth.title}</h2>
    <p className="tt-public-welcome__auth-copy">{copy.auth.body}</p>
    {hasPendingInvite && <p className="tt-account-gate__invite" role="status"><ShieldCheck size={15} /> {copy.auth.inviteSaved}</p>}
    {notice && <div className={`tt-account-gate__notice tt-account-gate__notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><AlertCircle size={15} /><span>{notice.text}</span><button type="button" aria-label={copy.auth.dismiss} onClick={onDismissNotice}>×</button></div>}
    <GoogleButton href={status.loginUrl} />
    <button className="tt-account-gate__retry" type="button" onClick={onRetry} disabled={checking}>
      <RefreshCw size={13} className={checking ? 'tt-account-gate__spin' : ''} />
      {checking ? copy.auth.checking : copy.auth.checkAgain}
    </button>
    <details className="tt-public-welcome__invite-details">
      <summary>{copy.auth.inviteHelpTitle}</summary>
      <p>{copy.auth.inviteHelp}</p>
    </details>
    <DemoLink />
  </section>;
}

/** The public landing for someone already signed in: same story, with a way back to their tables instead of sign-in. */
export function SignedInWelcome({ user, busy, onOpenTables, onStart, onSignOut, onLoadAdminWorkspaces }: { user: GoogleAuthUser | null; busy: boolean; onOpenTables: () => void; onStart: () => void; onSignOut: () => void; onLoadAdminWorkspaces?: (after?: string) => Promise<AdminWorkspacePage> }) {
  const openTables = (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); onOpenTables(); };
  const headerAction = <>
    <TablesLink className="tt-public-welcome__signin tt-public-welcome__tables-link" size={14} onClick={openTables} />
    {user && <ProfileMenu user={user} busy={busy} onOpenTables={onOpenTables} onSignOut={onSignOut} onLoadAdminWorkspaces={onLoadAdminWorkspaces} />}
  </>;
  return <PublicWelcome headerAction={headerAction} closingAction={<TablesLink className="tt-account-gate__google" size={16} onClick={openTables} />}>
    <WelcomePanel name={user?.name ?? null} onOpenTables={openTables} onStart={onStart} />
  </PublicWelcome>;
}

/** A round initials button in the landing header; opens the account menu (tables, language, admin, sign out). */
function ProfileMenu({ user, busy, onOpenTables, onSignOut, onLoadAdminWorkspaces }: { user: GoogleAuthUser; busy: boolean; onOpenTables: () => void; onSignOut: () => void; onLoadAdminWorkspaces?: (after?: string) => Promise<AdminWorkspacePage> }) {
  const copy = useLandingCopy();
  const switchLanguage = useContext(LandingLanguageSwitchContext);
  const [open, setOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, [open]);

  const choose = (action: () => void) => () => { setOpen(false); action(); };
  return <div className="tt-profile" ref={rootRef}>
    <button ref={triggerRef} type="button" className="tt-profile__trigger" aria-label={`${copy.profile.menu}: ${user.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span className="tt-profile__avatar" style={{ ['--tt-avatar-color' as string]: cursorColor(user.id) }} aria-hidden="true">{initials(user.name)}</span>
    </button>
    {open && <div className="tt-profile__menu" role="menu" aria-label={copy.profile.menu}>
      <div className="tt-profile__identity">
        <span className="tt-profile__avatar" style={{ ['--tt-avatar-color' as string]: cursorColor(user.id) }} aria-hidden="true">{initials(user.name)}</span>
        <span><strong>{user.name}</strong>{user.email && <small>{user.email}</small>}</span>
      </div>
      <button role="menuitem" type="button" onClick={choose(onOpenTables)}><LayoutGrid size={15} aria-hidden="true" />{copy.profile.yourTables}</button>
      <button role="menuitem" type="button" onClick={choose(switchLanguage)}><Languages size={15} aria-hidden="true" />{copy.profile.language}</button>
      {user.isAdmin && onLoadAdminWorkspaces && <button role="menuitem" type="button" onClick={choose(() => setAdminOpen(true))}><ShieldCheck size={15} aria-hidden="true" />{copy.profile.admin}</button>}
      <hr />
      <button role="menuitem" type="button" className="tt-profile__signout" disabled={busy} onClick={choose(onSignOut)}><LogOut size={15} aria-hidden="true" />{busy ? copy.profile.signingOut : copy.profile.signOut}</button>
    </div>}
    {adminOpen && onLoadAdminWorkspaces && <AdminMetadataDialog onLoad={onLoadAdminWorkspaces} onClose={() => setAdminOpen(false)} />}
  </div>;
}

function TablesLink({ className, size, onClick }: { className: string; size: number; onClick: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const copy = useLandingCopy();
  return <a className={className} href="/tables" onClick={onClick}><span>{copy.header.yourTables}</span> <ArrowRight size={size} aria-hidden="true" /></a>;
}

function WelcomePanel({ name, onOpenTables, onStart }: { name: string | null; onOpenTables: (event: MouseEvent<HTMLAnchorElement>) => void; onStart: () => void }) {
  const copy = useLandingCopy();
  return <section id="sign-in" className="tt-public-welcome__auth" aria-labelledby="tt-public-welcome-auth-title">
    <span className="tt-account-gate__eyebrow"><ShieldCheck size={14} /> {copy.welcome.eyebrow}</span>
    <h2 id="tt-public-welcome-auth-title">{copy.welcome.title(name)}</h2>
    <p className="tt-public-welcome__auth-copy">{copy.welcome.body}</p>
    <TablesLink className="tt-account-gate__google" size={16} onClick={onOpenTables} />
    <button className="tt-account-gate__retry" type="button" onClick={onStart}>{copy.welcome.start}</button>
    <DemoLink />
  </section>;
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
