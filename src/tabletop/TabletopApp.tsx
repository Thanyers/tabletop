import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownUp, ArrowRight, BookOpen, Check, ChevronDown, CircleAlert, Clipboard, LoaderCircle, Play, Plus, RefreshCw, RotateCcw, ShieldCheck, Sparkles, Table2, Users, X } from 'lucide-react';
import type { CaseKind, Seat, SessionView, WorkspaceView } from './shared/contracts';
import { planForWorkspace } from './runtime';
import { ApiFailure, clearInviteFragment, inviteFromFragment, tabletopClient, type AdminWorkspacePage, type AuthStatus, type ConnectionState, type GoogleAuthUser, type ModelJob, type TabletopCapabilities, type WorkspaceInvite } from './client';
import { ConfirmDialog, MemberStrip, UploadCapabilityProvider } from './ui/WorkbenchShared';
import { AccountBadge, AccountSignIn } from './ui/account';
import { AIProposal } from './ui/AIProposal';
import { TableSurface } from './ui/TableSurface';
import type { ExecutablePlan } from './ui/types';
import { summarize } from './ui/types';
import './ui/tabletop.css';

type SurfaceMode = 'canvas' | 'focus';
type EditMode = 'use' | 'arrange';
type InviteState = { seat: Seat; invite: WorkspaceInvite; url: string; revoked?: boolean } | null;

const lastWorkspaceKey = 'tabletop.lastWorkspace';
const pendingInviteKey = 'tabletop.pendingInvite';
const localCapabilities: TabletopCapabilities = { uploads: true, model: { enabled: false, reason: 'Live AI proposals are not configured on this local server.' } };

const caseInfo: Record<CaseKind, { title: string; subtitle: string; icon: typeof Table2 }> = {
  invoice: { title: 'Invoice check', subtitle: 'Match shipment charges with dated evidence.', icon: Table2 },
  teaching: { title: 'Physics lesson', subtitle: 'Teach one model through text, scene, and graph.', icon: BookOpen },
  encounter: { title: 'Shared encounter', subtitle: 'Run turns and reactions with a Dungeon Master.', icon: Users },
};

function errorText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.status === 401) return 'Your sign-in session has expired. Sign in again to continue.';
    if (error.status === 403) return 'This table is not available to the current session. Open a new invitation or choose another table.';
    if (error.status === 404) return 'This table or invitation is no longer available. Choose another table or ask for a fresh invitation.';
    if (error.status === 413) return 'That file is larger than the table limit. Choose a smaller file.';
    if (error.status === 415) return 'This file type is not supported. Use a shipment CSV or a text PDF.';
    if (error.status === 0) return error.message;
    return error.message;
  }
  return error instanceof Error ? error.message : 'The table could not be updated. Try again.';
}

function workspaceLabel(workspace: WorkspaceView): string {
  return `${caseInfo[workspace.kind].title} · ${workspace.title}`;
}

function saveLastWorkspace(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(lastWorkspaceKey, id);
    else window.localStorage.removeItem(lastWorkspaceKey);
  } catch {
    // Resume remains available through the server-provided workspace list.
  }
}

function savePendingInvite(ticket: string): boolean {
  if (!ticket || ticket.length > 4096) return false;
  try { window.sessionStorage.setItem(pendingInviteKey, ticket); return true; }
  catch { return false; }
}

function readPendingInvite(): string | null {
  try { return window.sessionStorage.getItem(pendingInviteKey); }
  catch { return null; }
}

function clearPendingInvite(): void {
  try { window.sessionStorage.removeItem(pendingInviteKey); }
  catch { /* The ticket expires on the server if session storage is unavailable. */ }
}

function accountForHeader(authStatus: AuthStatus | null, session: SessionView): GoogleAuthUser | null {
  if (authStatus?.mode !== 'google' || !authStatus.authenticated) return null;
  return authStatus.user ?? { id: session.actorId, name: session.name, email: '', isAdmin: false };
}

export default function TabletopApp() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [capabilities, setCapabilities] = useState<TabletopCapabilities>(localCapabilities);
  const [session, setSession] = useState<SessionView | null>(null);
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [starting, setStarting] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' | 'success' } | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [surface, setSurface] = useState<SurfaceMode>(() => window.matchMedia('(max-width: 760px)').matches ? 'focus' : 'canvas');
  const [editMode, setEditMode] = useState<EditMode>('use');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusSourceIds, setFocusSourceIds] = useState<string[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSeat, setInviteSeat] = useState<Seat | null>(null);
  const [inviteState, setInviteState] = useState<InviteState>(null);
  const [previousInvitesRevoked, setPreviousInvitesRevoked] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const workspaceRef = useRef<WorkspaceView | null>(null);
  const projectionSequenceRef = useRef(0);
  const inspectorScrollRef = useRef<HTMLDivElement>(null);
  const previousScrollRef = useRef(0);
  const noticeTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const handleInviteFragment = () => {
      if (!inviteFromFragment()) return;
      setStarting(true);
      setBootstrapAttempt((attempt) => attempt + 1);
    };
    window.addEventListener('hashchange', handleInviteFragment);
    return () => window.removeEventListener('hashchange', handleInviteFragment);
  }, []);

  const setWorkspace = useCallback((next: WorkspaceView | null) => {
    const previous = workspaceRef.current;
    const changedTable = previous?.id !== next?.id || previous?.epoch !== next?.epoch;
    workspaceRef.current = next;
    if (next) projectionSequenceRef.current += 1;
    setView(next);
    if (changedTable) {
      setSelectedNodeId(null);
      setFocusSourceIds([]);
    }
    if (previous?.id !== next?.id) {
      setInviteState(null);
      setInviteSeat(null);
      setPreviousInvitesRevoked(false);
    }
    if (next) saveLastWorkspace(next.id);
  }, []);

  const latestAfterAck = useCallback(async (ack: { duplicate: boolean; workspace: WorkspaceView }, workspaceId: string, requestSequence: number): Promise<WorkspaceView> => {
    if (workspaceRef.current?.id && workspaceRef.current.id !== workspaceId) return workspaceRef.current;
    if (!ack.duplicate && projectionSequenceRef.current === requestSequence) return ack.workspace;
    let latest: WorkspaceView | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (workspaceRef.current?.id && workspaceRef.current.id !== workspaceId) return workspaceRef.current;
      const sequenceBeforeRead = projectionSequenceRef.current;
      latest = await tabletopClient.workspace(workspaceId);
      if (workspaceRef.current?.id && workspaceRef.current.id !== workspaceId) return workspaceRef.current;
      if (projectionSequenceRef.current === sequenceBeforeRead) return latest;
    }
    const received = workspaceRef.current;
    if (received?.id === workspaceId) return received;
    if (latest) return latest;
    throw new ApiFailure('The action was accepted, but the latest table could not be refreshed. Refresh before repeating it.', 0);
  }, []);

  const showNotice = useCallback((text: string, tone: 'info' | 'error' | 'success' = 'info') => {
    setNotice({ text, tone });
    if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 7000);
  }, []);

  const refreshSession = useCallback(async () => {
    const next = await tabletopClient.openSession();
    setSession(next);
    return next;
  }, []);

  const retryBootstrap = useCallback(() => {
    setNotice(null);
    setStarting(true);
    setBootstrapAttempt((attempt) => attempt + 1);
  }, []);

  const openWorkspace = useCallback(async (id: string) => {
    setBusy('workspace.open');
    try {
      const next = await tabletopClient.workspace(id);
      setWorkspace(next);
      setWorkspaceMenuOpen(false);
      return next;
    } catch (error) {
      showNotice(errorText(error), 'error');
      return null;
    } finally {
      setBusy(null);
    }
  }, [setWorkspace, showNotice]);

  const signOut = useCallback(async () => {
    setBusy('auth.logout');
    let expired = false;
    try {
      await tabletopClient.logout();
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) expired = true;
      else {
        showNotice(errorText(error), 'error');
        setBusy(null);
        return;
      }
    }
    setSession(null);
    setWorkspace(null);
    saveLastWorkspace(null);
    clearPendingInvite();
    if (inviteFromFragment()) clearInviteFragment();
    setAuthStatus((current) => current?.mode === 'google' ? { ...current, authenticated: false, user: undefined } : current);
    setWorkspaceMenuOpen(false);
    setInviteOpen(false);
    setResetOpen(false);
    showNotice(expired ? 'Your sign-in session has expired. Sign in again to continue.' : 'You have signed out of your Google account.', expired ? 'error' : 'success');
    setBusy(null);
  }, [setWorkspace, showNotice]);

  useEffect(() => {
    let alive = true;
    const boot = async () => {
      const fragmentTicket = inviteFromFragment();
      const callbackUrl = new URL(window.location.href);
      const googleLoginFailed = callbackUrl.searchParams.get('auth_error') === 'google_login_failed';
      let currentAuth: AuthStatus | null = null;
      if (googleLoginFailed) {
        callbackUrl.searchParams.delete('auth_error');
        window.history.replaceState({}, document.title, `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`);
      }
      try {
        currentAuth = await tabletopClient.authStatus();
        if (!alive) return;
        setAuthStatus(currentAuth);
        if (googleLoginFailed) {
          if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current);
          noticeTimerRef.current = undefined;
          setNotice({ text: 'Google sign-in did not complete. Try again with Google. If it continues, ask your workspace owner to check account sign-in settings.', tone: 'error' });
        }
        if (currentAuth.mode === 'google' && !currentAuth.authenticated) {
          if (fragmentTicket) {
            if (savePendingInvite(fragmentTicket)) clearInviteFragment();
            else showNotice('This tab could not save the invitation securely. Keep the invitation link and try again after signing in.', 'error');
          }
          setSession(null);
          setWorkspace(null);
          return;
        }

        try {
          const currentCapabilities = await tabletopClient.capabilities();
          if (!alive) return;
          setCapabilities(currentCapabilities);
        } catch (error) {
          if (!alive) return;
          setCapabilities({ uploads: false, model: { enabled: false, reason: 'Feature access could not be checked. Refresh before adding files or requesting an AI draft.' } });
          showNotice('Feature access could not be checked. Uploads and AI requests are disabled until you refresh.', 'error');
          if (error instanceof ApiFailure && error.status === 401) {
            if (currentAuth?.mode === 'google') setAuthStatus({ ...currentAuth, authenticated: false, user: undefined });
            return;
          }
        }

        const currentSession = await tabletopClient.openSession();
        if (!alive) return;
        setSession(currentSession);
        const inviteTicket = fragmentTicket ?? readPendingInvite();
        if (inviteTicket) {
          try {
            const joined = await tabletopClient.redeem(inviteTicket);
            clearInviteFragment();
            clearPendingInvite();
            if (!alive) return;
            setWorkspace(joined);
            await refreshSession();
            showNotice(`You joined ${joined.title}. This invitation is now used.`, 'success');
          } catch (error) {
            clearInviteFragment();
            clearPendingInvite();
            if (alive) showNotice(errorText(error), 'error');
          }
        } else {
          let lastId: string | null = null;
          try { lastId = window.localStorage.getItem(lastWorkspaceKey); } catch { lastId = null; }
          const resumeId = currentSession.workspaces.find((item) => item.id === lastId)?.id ?? currentSession.workspaces[0]?.id;
          if (resumeId) {
            const resumed = await tabletopClient.workspace(resumeId);
            if (alive) setWorkspace(resumed);
          }
        }
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401 && currentAuth?.mode === 'google') {
          setAuthStatus({ ...currentAuth, authenticated: false, user: undefined });
        }
        if (alive) showNotice(errorText(error), 'error');
      } finally {
        if (alive) setStarting(false);
      }
    };
    void boot();
    return () => { alive = false; };
  }, [bootstrapAttempt, refreshSession, setWorkspace, showNotice]);

  useEffect(() => {
    if (!view) return;
    return tabletopClient.subscribe(view.id, (next) => {
      if (workspaceRef.current?.id === next.id) setWorkspace(next);
    }, setConnection);
  }, [view?.id, setWorkspace]);

  useEffect(() => () => { if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current); }, []);

  const compiled = useMemo((): { plan: ExecutablePlan | null; error: string | null } => {
    if (!view) return { plan: null, error: null };
    try { return { plan: planForWorkspace(view), error: null }; }
    catch (error) { return { plan: null, error: error instanceof Error ? error.message : 'The current table plan could not be rendered.' }; }
  }, [view]);

  const createWorkspace = useCallback(async (kind: CaseKind) => {
    setBusy('workspace.create');
    try {
      const next = await tabletopClient.createWorkspace(kind);
      setWorkspace(next);
      await refreshSession();
      showNotice(`${caseInfo[kind].title} is ready.`, 'success');
    } catch (error) {
      showNotice(errorText(error), 'error');
    } finally { setBusy(null); setWorkspaceMenuOpen(false); }
  }, [refreshSession, setWorkspace, showNotice]);

  const runCommand = useCallback(async (type: string, payload: unknown): Promise<WorkspaceView | null> => {
    const current = workspaceRef.current;
    if (!current) return null;
    const requestSequence = projectionSequenceRef.current;
    setBusy(type);
    try {
      const ack = await tabletopClient.command(current, type, payload);
      const latest = await latestAfterAck(ack, current.id, requestSequence);
      setWorkspace(latest);
      if (type === 'evolve.activate') showNotice(`The change is active at revision ${latest.domain.ruleRevision}.`, 'success');
      else if (type === 'workspace.reset') {
        setPreviousInvitesRevoked(true);
        setInviteState((previous) => previous ? { seat: previous.seat, invite: previous.invite, url: '', revoked: true } : null);
        showNotice('The table was reset. Previous member access and invitations were revoked.', 'success');
      } else if (type.startsWith('evolve.')) showNotice('Draft state updated. Active values remain unchanged until activation.', 'success');
      else if (type === 'teaching.answer') showNotice('Your answer was checked against the current lesson.', 'success');
      else if (type === 'encounter.endTurn') showNotice('The server started the next turn and updated its action points.', 'success');
      else showNotice('Table updated.', 'success');
      await refreshSession().catch(() => undefined);
      return latest;
    } catch (error) {
      if (error instanceof ApiFailure && error.conflict) {
        try {
          const fresh = await tabletopClient.workspace(current.id);
          if (workspaceRef.current?.id === current.id) setWorkspace(fresh);
          await refreshSession().catch(() => undefined);
          showNotice('This table changed elsewhere. The latest version is loaded; review and repeat your edit if it still applies.', 'error');
        } catch (refreshError) { showNotice(errorText(refreshError), 'error'); }
      } else showNotice(errorText(error), 'error');
      return null;
    } finally { setBusy(null); }
  }, [latestAfterAck, refreshSession, setWorkspace, showNotice]);

  const upload = useCallback(async (kind: 'shipments' | 'invoice' | 'rate-card', file: File) => {
    if (!capabilities.uploads) throw new Error('File uploads are disabled for this workspace service. Your existing rows and manual editing remain available.');
    const current = workspaceRef.current;
    if (!current) throw new Error('Choose an invoice table before adding a source file.');
    setBusy(`upload.${kind}`);
    try {
      const dataBase64 = await fileToBase64(file);
      const requestSequence = projectionSequenceRef.current;
      const ack = await tabletopClient.upload(current, { filename: file.name, mime: file.type || inferredMime(file.name), kind, dataBase64 });
      const latest = await latestAfterAck(ack, current.id, requestSequence);
      setWorkspace(latest);
      showNotice(`${file.name} was added to this table. Review its extracted text before using it.`, 'success');
      await refreshSession().catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiFailure && error.conflict) {
        const fresh = await tabletopClient.workspace(current.id).catch(() => null);
        if (fresh && workspaceRef.current?.id === current.id) setWorkspace(fresh);
        showNotice('This table changed while the file was being prepared. The latest version is loaded; choose the file again if it still belongs here.', 'error');
      }
      throw new Error(errorText(error));
    } finally { setBusy(null); }
  }, [capabilities.uploads, latestAfterAck, refreshSession, setWorkspace, showNotice]);

  const requestAI = useCallback((targetView: WorkspaceView, prompt: string, sourceId: string | undefined, commandId: string): Promise<ModelJob> => {
    if (!capabilities.model.enabled) return Promise.reject(new ApiFailure('AI proposals are not enabled for this workspace.', 403));
    const roleAllowed = targetView.kind === 'invoice' ? targetView.actor.role === 'owner' : targetView.kind === 'teaching' ? targetView.actor.role === 'teacher' : targetView.actor.role === 'dm';
    if (!roleAllowed) return Promise.reject(new ApiFailure('This seat cannot request an AI draft.', 403));
    return tabletopClient.requestModel(targetView, prompt, sourceId, commandId);
  }, [capabilities.model.enabled]);

  const pollAI = useCallback((workspaceId: string, jobId: string) => tabletopClient.modelJob(workspaceId, jobId), []);
  const loadAdminWorkspaces = useCallback((after?: string) => tabletopClient.adminWorkspaces(after), []);

  const refreshWorkspaceProjection = useCallback(async (workspaceId: string) => {
    const latest = await tabletopClient.workspace(workspaceId);
    if (workspaceRef.current?.id === workspaceId) setWorkspace(latest);
  }, [setWorkspace]);

  const download = useCallback(async (format: 'csv' | 'html') => {
    const current = workspaceRef.current;
    if (!current) return;
    setBusy(`export.${format}`);
    try {
      const blob = await tabletopClient.export(current.id, format);
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = `${current.title.trim().replaceAll(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 64) || 'tabletop-export'}.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1500);
      showNotice(`${format.toUpperCase()} export is ready.`, 'success');
    } catch (error) { showNotice(errorText(error), 'error'); }
    finally { setBusy(null); }
  }, [showNotice]);

  const createInvite = useCallback(async (seat: Seat, replaceOutstanding = false) => {
    const current = workspaceRef.current;
    if (!current) return;
    setInviteBusy(true);
    try {
      const invite = await tabletopClient.invite(current.id, seat, replaceOutstanding);
      const url = new URL(window.location.href);
      url.hash = new URLSearchParams({ invite: invite.ticket }).toString();
      setInviteState({ seat, invite, url: url.toString() });
      setPreviousInvitesRevoked(false);
      setInviteSeat(seat);
      setCopied(false);
      showNotice(`${replaceOutstanding ? 'The previous unused link is revoked. ' : ''}A single-use invitation for ${seatLabel(seat)} is ready.`, 'success');
    } catch (error) { showNotice(errorText(error), 'error'); }
    finally { setInviteBusy(false); }
  }, [showNotice]);

  const focusEvidence = useCallback((sourceIds: string[]) => {
    if (!view) return;
    if (inspectorScrollRef.current) previousScrollRef.current = inspectorScrollRef.current.scrollTop;
    setFocusSourceIds(sourceIds);
    setSurface('focus');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => document.getElementById('tt-evidence-section')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
  }, [view]);

  const backFromEvidence = useCallback(() => {
    setFocusSourceIds([]);
    window.requestAnimationFrame(() => {
      if (inspectorScrollRef.current) inspectorScrollRef.current.scrollTop = previousScrollRef.current;
    });
  }, []);

  const selectCanvasNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId && window.matchMedia('(max-width: 760px)').matches) setSurface('focus');
  }, []);

  const focusAIProposal = useCallback(() => {
    setSurface('focus');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => document.getElementById('tt-ai-proposal')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
  }, []);

  const beginReset = useCallback(async () => {
    const result = await runCommand('workspace.reset', {});
    if (result) setResetOpen(false);
  }, [runCommand]);

  const copyInvite = useCallback(async () => {
    if (!inviteState?.url) return;
    try { await navigator.clipboard.writeText(inviteState.url); setCopied(true); }
    catch { setCopied(false); showNotice('Select the invitation link and copy it with your keyboard.', 'info'); }
  }, [inviteState, showNotice]);

  if (starting) return <LoadingScreen />;
  if (authStatus?.mode === 'google' && !authStatus.authenticated) return <AccountSignIn status={authStatus} notice={notice} hasPendingInvite={Boolean(readPendingInvite() || inviteFromFragment())} checking={false} onRetry={retryBootstrap} onDismissNotice={() => setNotice(null)} />;
  if (!session) return <FailureScreen onRetry={retryBootstrap} notice={notice} />;
  const headerAccount = accountForHeader(authStatus, session);
  if (!view) return <WorkspaceChooser session={session} account={headerAccount} onLoadAdminWorkspaces={loadAdminWorkspaces} busy={busy} notice={notice} onDismissNotice={() => setNotice(null)} onSignOut={() => void signOut()} onCreate={(kind) => void createWorkspace(kind)} onOpen={(id) => void openWorkspace(id)} />;

  const selectedNode = compiled.plan?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const canInvite = view.kind !== 'invoice' && ['teacher', 'dm'].includes(view.actor.role);
  const canReset = ['owner', 'teacher', 'dm'].includes(view.actor.role);
  const canAskAI = (view.kind === 'invoice' && view.actor.role === 'owner') || (view.kind === 'teaching' && view.actor.role === 'teacher') || (view.kind === 'encounter' && view.actor.role === 'dm');
  const connectedSeats = new Set(view.members.map((member) => member.seat).filter(Boolean));
  const inviteSeats: Seat[] = view.kind === 'teaching' ? ['learner-1', 'learner-2'] : view.kind === 'encounter' ? ['mira', 'pip'] : [];
  const inviteIsHeld = inviteState !== null && !inviteState.revoked && inviteState.invite.expiresAt > Date.now() && !connectedSeats.has(inviteState.seat);
  const remainingInviteSeats = inviteSeats.filter((seat) => !connectedSeats.has(seat) && !(inviteIsHeld && inviteState?.seat === seat));

  return (
    <UploadCapabilityProvider enabled={capabilities.uploads} reason={capabilities.uploads ? '' : 'File uploads are disabled for this service. Manual editing remains available.'}>
    <div className="tt-app">
      <header className="tt-topbar">
        <a className="tt-brand" href="#table" aria-label="Tabletop workspace"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></a>
        <span className="tt-topbar__divider" aria-hidden="true" />
        <div className="tt-workspace-picker">
          <button type="button" className="tt-workspace-picker__button" aria-haspopup="menu" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen((open) => !open)}><span><small>TABLE</small><strong>{workspaceLabel(view)}</strong></span><ChevronDown size={15} /></button>
          {workspaceMenuOpen && <>
            <button className="tt-menu-dismiss" type="button" aria-label="Close table menu" onClick={() => setWorkspaceMenuOpen(false)} />
            <div className="tt-workspace-menu" role="menu"><span className="tt-kicker">YOUR TABLES</span>{session.workspaces.map((item) => <button role="menuitem" type="button" className={item.id === view.id ? 'is-current' : ''} key={item.id} onClick={() => void openWorkspace(item.id)}><CaseIcon kind={item.kind} /><span><strong>{item.title}</strong><small>{caseInfo[item.kind].title} · {item.role}</small></span>{item.id === view.id && <Check size={14} />}</button>)}<hr /><span className="tt-kicker">START A TABLE</span>{(['invoice', 'teaching', 'encounter'] as const).map((kind) => <button role="menuitem" type="button" key={kind} onClick={() => void createWorkspace(kind)}><Plus size={15} /><span><strong>{caseInfo[kind].title}</strong><small>{caseInfo[kind].subtitle}</small></span><ArrowRight size={14} /></button>)}<hr /><a role="menuitem" className="tt-workspace-menu__demo" href="/demo" target="_blank" rel="noopener" aria-label="Auto demo (opens in a new tab)"><Play size={15} fill="currentColor" /><span><strong>Auto demo</strong><small>Opens in a new tab</small></span><ArrowRight size={14} /></a></div>
          </>}
        </div>
        <div className="tt-topbar__spacer" />
        <a className="tt-auto-demo-link" href="/demo" target="_blank" rel="noopener" aria-label="Auto demo (opens in a new tab)" title="Opens in a new tab"><Play size={13} fill="currentColor" /><span>Auto demo</span><small aria-hidden="true">↗</small></a>
        {headerAccount && <AccountBadge user={headerAccount} busy={busy === 'auth.logout'} onSignOut={() => void signOut()} onLoadAdminWorkspaces={loadAdminWorkspaces} />}
        <div className="tt-connection" data-state={connection} role="status"><i aria-hidden="true" /><span>{connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting' : connection === 'offline' ? 'Connection lost' : 'Reconnecting'}</span></div>
        <span className="tt-role-chip">{view.actor.role}</span>
        {view.kind !== 'invoice' && <button type="button" className="tt-people-button" onClick={() => { setInviteOpen(true); setInviteSeat(null); setCopied(false); }} aria-label={`People at this table, ${view.members.length} connected`}><Users size={16} /><span>{view.members.length}</span></button>}
        {canInvite && <button type="button" className="tt-button tt-button--quiet tt-invite-button" onClick={() => { setInviteOpen(true); setInviteSeat(null); setCopied(false); }}><Plus size={14} /> Invite</button>}
        {canReset && <button type="button" className="tt-topbar-icon" title="Reset table" aria-label="Reset table" onClick={() => setResetOpen(true)}><RotateCcw size={15} /></button>}
        <button type="button" className="tt-topbar-icon" title="Refresh latest table" aria-label="Refresh latest table" disabled={busy !== null} onClick={() => void openWorkspace(view.id)}><RefreshCw size={15} className={busy === 'workspace.open' ? 'tt-spin' : ''} /></button>
      </header>

      <div className="tt-layout-controls">
        <div className="tt-mode-switch" role="group" aria-label="Edit mode"><button type="button" aria-pressed={editMode === 'use'} className={editMode === 'use' ? 'is-active' : ''} onClick={() => setEditMode('use')}><Check size={13} /> Use</button><button type="button" aria-pressed={editMode === 'arrange'} className={editMode === 'arrange' ? 'is-active' : ''} onClick={() => setEditMode('arrange')}><ArrowDownUp size={13} /> Arrange</button></div>
        <span className="tt-layout-controls__hint">{editMode === 'use' ? 'Select a source, result, rule, or scene to work with its controls.' : 'Drag objects to arrange this canvas.'}</span>
        <div className="tt-mobile-switch" role="group" aria-label="Workspace view"><button type="button" aria-pressed={surface === 'canvas'} className={surface === 'canvas' ? 'is-active' : ''} onClick={() => setSurface('canvas')}>Canvas</button><button type="button" aria-pressed={surface === 'focus'} className={surface === 'focus' ? 'is-active' : ''} onClick={() => setSurface('focus')}>Focus table</button></div>
        {canAskAI && capabilities.model.enabled && <button type="button" className="tt-button tt-button--quiet tt-ai-launch" onClick={focusAIProposal}><Sparkles size={13} /> Ask AI</button>}
        <span className="tt-layout-controls__revision">r{view.domain.ruleRevision} · data r{view.domain.dataRevision}</span>
      </div>

      {notice && <div className={`tt-notice tt-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.tone === 'error' ? <CircleAlert size={15} /> : notice.tone === 'success' ? <Check size={15} /> : <Activity size={15} />}</span><p>{notice.text}</p><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={14} /></button></div>}

      <TableSurface
        view={view}
        plan={compiled.plan}
        planError={compiled.error}
        surface={surface}
        editMode={editMode}
        selectedNodeId={selectedNodeId}
        onSelectNode={selectCanvasNode}
        onCommand={runCommand}
        busy={busy}
        onUpload={upload}
        onExport={download}
        onFocusEvidence={focusEvidence}
        onBackFromEvidence={backFromEvidence}
        focusSourceIds={focusSourceIds}
        inspectorScrollRef={inspectorScrollRef}
        onReload={() => void openWorkspace(view.id)}
        inspectorContent={<>
          {canAskAI && <AIProposal view={view} capabilities={capabilities} onRequest={requestAI} onPoll={pollAI} onRefresh={refreshWorkspaceProjection} />}
          {selectedNode && compiled.plan && <ObjectInspector node={selectedNode} plan={compiled.plan} onClose={() => setSelectedNodeId(null)} />}
        </>}
      />

      {inviteOpen && <InviteDialog view={view} availableSeats={remainingInviteSeats} canInvite={canInvite} busy={inviteBusy} invite={inviteState} previousInvitesRevoked={previousInvitesRevoked} copied={copied} onSelectSeat={setInviteSeat} selectedSeat={inviteSeat} onCreate={(seat, replace) => void createInvite(seat, replace)} onCopy={() => void copyInvite()} onClose={() => setInviteOpen(false)} />}
      {resetOpen && <ConfirmDialog title="Reset this table?" confirmLabel="Reset table" busy={busy === 'workspace.reset'} onClose={() => setResetOpen(false)} onConfirm={() => void beginReset()}><p>This clears the current table contents, drafts, and unresolved actions. Existing invitation links and member access are revoked. You will keep your table role.</p><p>The reset creates a new table revision and cannot be undone.</p></ConfirmDialog>}
    </div>
    </UploadCapabilityProvider>
  );
}

function LoadingScreen() {
  return <main className="tt-loading" role="status" aria-live="polite"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><strong>Opening your table</strong><span><LoaderCircle size={14} className="tt-spin" /> Checking your workspace</span></main>;
}

function FailureScreen({ notice, onRetry }: { notice: { text: string; tone: 'info' | 'error' | 'success' } | null; onRetry: () => void }) {
  return <main className="tt-failure"><span className="tt-dialog__mark"><CircleAlert size={18} /></span><p className="tt-kicker">TABLETOP</p><h1>The table could not be opened</h1><p>{notice?.text ?? 'Check your connection and try again.'}</p><button type="button" className="tt-button tt-button--primary" onClick={onRetry}><RefreshCw size={14} /> Try again</button></main>;
}

function WorkspaceChooser({ session, account, onLoadAdminWorkspaces, busy, notice, onDismissNotice, onSignOut, onCreate, onOpen }: { session: SessionView; account: GoogleAuthUser | null; onLoadAdminWorkspaces: (after?: string) => Promise<AdminWorkspacePage>; busy: string | null; notice: { text: string; tone: 'info' | 'error' | 'success' } | null; onDismissNotice: () => void; onSignOut: () => void; onCreate: (kind: CaseKind) => void; onOpen: (id: string) => void }) {
  return <main className="tt-chooser"><header className="tt-chooser__top"><a className="tt-brand" href="#table" aria-label="Tabletop"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></a><a className="tt-chooser-demo-link" href="/demo" target="_blank" rel="noopener" aria-label="Auto demo (opens in a new tab)"><Play size={13} fill="currentColor" /><span>Auto demo</span><small>↗</small></a>{account ? <AccountBadge user={account} busy={busy === 'auth.logout'} onSignOut={onSignOut} onLoadAdminWorkspaces={onLoadAdminWorkspaces} /> : <span className="tt-session-name">Signed in as {session.name}</span>}</header>
    {notice && <div className={`tt-notice tt-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.tone === 'error' ? <CircleAlert size={15} /> : <Activity size={15} />}</span><p>{notice.text}</p><button type="button" aria-label="Dismiss message" onClick={onDismissNotice}><X size={14} /></button></div>}
    <section className="tt-chooser__content"><span className="tt-kicker">YOUR WORK TABLES</span><h1>Choose a table</h1><p>Open an existing table or start a new one.</p>
      {session.workspaces.length > 0 && <div className="tt-existing-tables">{session.workspaces.map((workspace) => <button type="button" key={workspace.id} onClick={() => onOpen(workspace.id)} disabled={busy !== null}><CaseIcon kind={workspace.kind} /><span><strong>{workspace.title}</strong><small>{caseInfo[workspace.kind].title} · {workspace.role}</small></span><ArrowRight size={16} /></button>)}</div>}
      <div className="tt-start-table"><span className="tt-kicker">START A TABLE</span>{(['invoice', 'teaching', 'encounter'] as const).map((kind) => <button className="tt-case-choice" type="button" key={kind} disabled={busy !== null} onClick={() => onCreate(kind)}><CaseIcon kind={kind} /><span><strong>{caseInfo[kind].title}</strong><small>{caseInfo[kind].subtitle}</small></span>{busy === 'workspace.create' ? <LoaderCircle size={15} className="tt-spin" /> : <Plus size={15} />}</button>)}</div>
    </section>
  </main>;
}

function CaseIcon({ kind }: { kind: CaseKind }) {
  const Icon = caseInfo[kind].icon;
  return <span className={`tt-case-icon tt-case-icon--${kind}`} aria-hidden="true"><Icon size={17} /></span>;
}

function ObjectInspector({ node, plan, onClose }: { node: ExecutablePlan['nodes'][number]; plan: ExecutablePlan; onClose: () => void }) {
  const inputs = Object.entries(node.inputs);
  const outputs = Object.entries(plan.outputs[node.id] ?? {});
  const links = plan.bindings.filter((binding) => binding.from.node === node.id || binding.to.node === node.id);
  return <section className="tt-object-inspector" aria-labelledby="tt-selected-object-title"><header><span className="tt-object-inspector__glyph"><Activity size={15} /></span><div><span className="tt-kicker">SELECTED OBJECT</span><h2 id="tt-selected-object-title">{node.title}</h2></div><button type="button" aria-label="Close object details" onClick={onClose}><X size={14} /></button></header><p className="tt-object-capability">{node.capability} · version {node.version}</p><div className="tt-object-facts">{inputs.length > 0 ? inputs.map(([key, value]) => <div key={key}><span>Input · {key}</span><strong title={summarize(value)}>{summarize(value)}</strong></div>) : <div><span>Inputs</span><strong>No literal values; data comes through a connected object.</strong></div>}{outputs.map(([key, value]) => <div key={`out-${key}`}><span>Output · {key}</span><strong title={summarize(value)}>{summarize(value)}</strong></div>)}</div>{links.length > 0 && <ul className="tt-object-links">{links.slice(0, 4).map((link) => <li key={link.id}><span>{link.from.node === node.id ? 'Sends' : 'Receives'}</span><strong>{link.valueType}</strong><small>{link.from.node === node.id ? `${link.to.node} · ${link.to.port}` : `${link.from.node} · ${link.from.port}`}</small></li>)}</ul>}</section>;
}

function InviteDialog({ view, availableSeats, canInvite, busy, invite, previousInvitesRevoked, copied, onSelectSeat, selectedSeat, onCreate, onCopy, onClose }: { view: WorkspaceView; availableSeats: Seat[]; canInvite: boolean; busy: boolean; invite: InviteState; previousInvitesRevoked: boolean; copied: boolean; onSelectSeat: (seat: Seat | null) => void; selectedSeat: Seat | null; onCreate: (seat: Seat, replaceOutstanding?: boolean) => void; onCopy: () => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => { window.clearTimeout(timer); previous?.focus(); };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (selectedSeat) createButtonRef.current?.focus(); }, [selectedSeat]);

  const activeMember = invite ? view.members.find((member) => member.seat === invite.seat) : undefined;
  const expired = invite ? invite.invite.expiresAt <= tick : false;
  const seatChoices = [...availableSeats];
  if (invite && !invite.revoked && expired && !activeMember && !seatChoices.includes(invite.seat)) seatChoices.push(invite.seat);
  const closeOnEscape = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !busy) { onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []);
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="tt-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={dialogRef} className="tt-dialog tt-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="tt-invite-title" tabIndex={-1} onKeyDown={closeOnEscape}>
    <span className="tt-dialog__mark"><Users size={17} /></span><h2 id="tt-invite-title">People at this table</h2><p>Only invited seats can join. Each invitation works once and expires after ten minutes.</p><MemberStrip view={view} />
    {previousInvitesRevoked && <div className="tt-invite-status tt-invite-status--revoked"><ShieldCheck size={15} /><span><strong>Previous invitation links revoked</strong><small>The table reset invalidated links and removed the previous members.</small></span></div>}
    {invite && !invite.revoked && activeMember ? <div className="tt-invite-status tt-invite-status--joined"><Check size={15} /><span><strong>{activeMember.name} joined as {seatLabel(invite.seat)}</strong><small>This one-use invitation has been accepted.</small></span></div> : invite && !invite.revoked && expired ? <div className="tt-invite-status tt-invite-status--expired"><CircleAlert size={15} /><span><strong>Invitation expired</strong><small>Create a new one for this seat.</small></span></div> : invite && !invite.revoked ? <div className="tt-invite-created"><div className="tt-invite-status"><Activity size={15} /><span><strong>Waiting for {seatLabel(invite.seat)}</strong><small>Expires {new Date(invite.invite.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span></div><label htmlFor="tt-invite-link">One-use invitation link</label><div className="tt-invite-link-row"><input id="tt-invite-link" value={invite.url} readOnly onFocus={(event) => event.currentTarget.select()} /><button type="button" className="tt-button tt-button--primary" onClick={onCopy}><Clipboard size={14} /> {copied ? 'Copied' : 'Copy link'}</button></div><small>The link is held only in this open panel. Send it to the person taking this seat.</small></div> : null}
    {canInvite ? <div className="tt-invite-choose"><span className="tt-kicker">AVAILABLE SEATS</span>{seatChoices.length === 0 ? <p>All supported seats are filled. Reset a table to revoke access or choose another table.</p> : seatChoices.map((seat) => <button type="button" className={selectedSeat === seat ? 'is-selected' : ''} key={seat} onClick={() => onSelectSeat(seat)}><span><strong>{seatLabel(seat)}</strong><small>{view.kind === 'teaching' ? 'Learner view and private answer' : 'Player view and character actions'}</small></span>{selectedSeat === seat ? <Check size={14} /> : <ArrowRight size={14} />}</button>)}</div> : <div className="tt-invite-status"><Users size={15} /><span><strong>Table members</strong><small>Only the teacher or Dungeon Master can send invitations.</small></span></div>}
    {canInvite && selectedSeat && !view.members.some(member => member.seat === selectedSeat) && <details className="tt-invite-recovery"><summary>Lost an unused invitation link?</summary><p>Replace the link for {seatLabel(selectedSeat)}. Any previous unused link for this seat will stop working.</p><button type="button" className="tt-button tt-button--quiet" disabled={busy} onClick={() => onCreate(selectedSeat, true)}>Revoke old link and issue new link</button></details>}
    <footer><button ref={closeButtonRef} type="button" className="tt-button tt-button--quiet" onClick={onClose}>Close</button>{canInvite && selectedSeat && (!invite || invite.seat !== selectedSeat || expired || invite.revoked || activeMember) && <button ref={createButtonRef} type="button" className="tt-button tt-button--primary" disabled={busy || view.members.some(member => member.seat === selectedSeat)} onClick={() => onCreate(selectedSeat)}>{busy ? <LoaderCircle size={14} className="tt-spin" /> : <Plus size={14} />} Create invitation for {seatLabel(selectedSeat)}</button>}</footer>
  </section></div>;
}

function seatLabel(seat: Seat): string {
  if (seat === 'learner-1') return 'Learner 1';
  if (seat === 'learner-2') return 'Learner 2';
  return seat === 'mira' ? 'Mira' : 'Pip';
}

function inferredMime(filename: string): string {
  return filename.toLowerCase().endsWith('.csv') ? 'text/csv' : filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : filename.toLowerCase().endsWith('.txt') ? 'text/plain' : 'application/octet-stream';
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read from this device.'));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const comma = value.indexOf(',');
      if (comma < 0) reject(new Error('The file could not be prepared for upload.'));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
