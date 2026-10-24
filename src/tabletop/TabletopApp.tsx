import { RoleSettings } from './ui/RoleSettings';
import { viewerCan } from './shared/permissions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, Pencil, CircleAlert, Clipboard, LoaderCircle, MoreHorizontal, Play, Plus, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Table2, Users, X } from 'lucide-react';
import { NODE_TABLE_MEMBER_SEATS, TABLE_MEMBER_SEATS, tableMemberSeatLimit, type CaseKind, type Seat, type SessionView, type WorkspaceView } from './shared/contracts';
import type { TableAssistantHistoryPage, TableAssistantJob } from './shared/table-assistant-contracts';
import type { TableState } from './shared/table-contracts';
import { planForWorkspace } from './runtime';
import { parseRoute, routePath, saveReturnPath, takeReturnPath } from './routes';
import { relativeTime } from './ui/relative-time';
import { NO_TABLE_FILTER, filterTables, isFiltered, listDate, type TableListFilter, type TableOwnership, type TableRecency, type TableSort } from './ui/table-list-filter';
import { ApiFailure, clearInviteFragment, inviteFromFragment, isInviteLink, tabletopClient, type AdminWorkspacePage, type AuthStatus, type ConnectionState, type GoogleAuthUser, type ModelJob, type TabletopCapabilities, type WorkspaceInvite } from './client';
import { InviteLinkPanel } from './ui/InviteLinkPanel';
import { ConfirmDialog, MemberStrip, UploadCapabilityProvider } from './ui/WorkbenchShared';
import { LiveCursorProvider, createCursorStore } from './ui/live-cursors';
import { HeaderPeople } from './ui/HeaderPeople';
import { AccountBadge, AccountMenu, AccountSignIn, SignedInWelcome } from './ui/account';
import { AIProposal } from './ui/AIProposal';
import { useTableChat } from './ui/useTableChat';
import { addNote, imagesLeft, noteLimitReason, pinImages } from './ui/NoteCard';
import type { AddableWebSource } from './ui/table-chat-state';
import { TableSurface } from './ui/TableSurface';
import { StartPage } from './ui/StartPage';
import { starterFor } from './shared/starters';
import { displayWorkspaceTitle, normalizeWorkspaceTitle, WORKSPACE_TITLE_MAX_CHARS } from './shared/workspace-title';
import { DEFAULT_CANVAS_AUXILIARY_IDS } from './ui/CanvasWorkspace';
import type { ExecutablePlan } from './ui/types';
import { summarize } from './ui/types';
import { recordServerRoll } from './ui/roll-store';
import { createWorkspaceCommandSession, sameWorkspaceActor, type ProjectionClock, type UploadKind } from './workspace/command-session';
import { errorText } from './workspace/error-text';
import { fileToBase64 } from './workspace/source-file';
import { LoadingScreen } from '../loading/LoadingScreen';
import './ui/tabletop.css';
import './ui/calm-workspace.css';

type InviteState = { seat: Seat; invite: WorkspaceInvite; url: string; revoked?: boolean } | null;

const lastWorkspaceKey = 'tabletop.lastWorkspace';
const tableSortKey = 'tabletop.tables.sort';
const pendingInviteKey = 'tabletop.pendingInvite';
const localCapabilities: TabletopCapabilities = {
  uploads: true,
  tableReadOnly: false,
  tableAssistant: { available: false, reason: 'Conversation is not available in this local workspace. You can continue using the Canvas and reviewing rules.' },
  model: { enabled: false, reason: 'Live AI proposals are not configured on this local server.' },
};

const caseInfo: Record<CaseKind, { title: string; subtitle: string; icon: typeof Table2 }> = {
  invoice: { title: starterFor('invoice').title, subtitle: starterFor('invoice').summary, icon: Table2 },
  teaching: { title: starterFor('teaching').title, subtitle: starterFor('teaching').summary, icon: BookOpen },
  encounter: { title: starterFor('encounter').title, subtitle: starterFor('encounter').summary, icon: Users },
  table: { title: 'Shared data table', subtitle: 'Build collections and actions from your own files.', icon: Table2 },
};

function isTableWorkspaceView(view: WorkspaceView): view is WorkspaceView & { kind: 'table'; domain: TableState } {
  return view.kind === 'table' && view.domain.kind === 'table';
}

function workspaceDisplayTitle(workspace: WorkspaceView): string {
  const programTitle = workspace.kind === 'table' && workspace.domain.kind === 'table' ? workspace.domain.program?.title : undefined;
  return displayWorkspaceTitle(workspace.kind, workspace.title, programTitle);
}

function workspaceLabel(workspace: WorkspaceView): string {
  return workspaceDisplayTitle(workspace);
}

function readLastWorkspace(): string | null {
  try { return window.localStorage.getItem(lastWorkspaceKey); } catch { return null; }
}

function saveLastWorkspace(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(lastWorkspaceKey, id);
    else window.localStorage.removeItem(lastWorkspaceKey);
  } catch {
    // Resume remains available through the server-provided workspace list.
  }
}

/** The /tables order the reader picked last time; the list still defaults to the newest change (F053). */
function readTableSort(): TableSort {
  try { return window.localStorage.getItem(tableSortKey) === 'created' ? 'created' : 'updated'; } catch { return 'updated'; }
}

function saveTableSort(sort: TableSort): void {
  try { window.localStorage.setItem(tableSortKey, sort); } catch {
    // Storage can be blocked; the chosen order still applies for this visit.
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

type AppPage = 'landing' | 'tables' | 'new';

/** Where to land after Google sign-in: the page asked for, or the table list when it was the landing page. */
function rememberReturnPath(path: string): void {
  saveReturnPath(parseRoute(path)?.name === 'landing' ? routePath({ name: 'tables' }) : path);
}

export default function TabletopApp() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [capabilities, setCapabilities] = useState<TabletopCapabilities>(localCapabilities);
  const [session, setSession] = useState<SessionView | null>(null);
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [starting, setStarting] = useState(true);
  // Which page shows while no table is open: the table list or the /new start page.
  const [page, setPage] = useState<AppPage>('landing');
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const pageRef = useRef<AppPage>('landing');
  pageRef.current = page;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' | 'success'; action?: { label: string; run: () => void } } | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState('');
  const [aiPrefill, setAiPrefill] = useState<{ text: string; key: number } | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [openedObjectId, setOpenedObjectId] = useState<string | null>(null);
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
  const capabilitiesRef = useRef(capabilities);
  capabilitiesRef.current = capabilities;
  // How the next change of open table is written to the address bar: the first
  // sync after boot replaces, user navigation pushes, back/forward writes nothing.
  const urlSyncRef = useRef<'replace' | 'push' | 'none'>('replace');
  // F078-T5a: the command/readback seam and this component share one projection clock. The
  // setter below bumps it whenever a projection is applied, and readback compares the value
  // captured before a command with the value afterwards to tell "nothing newer arrived" apart
  // from "a newer projection already landed".
  const projectionClock = useRef<ProjectionClock>({ value: 0 });
  const inspectorScrollRef = useRef<HTMLDivElement>(null);
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
    const changedTable = previous?.id !== next?.id || previous?.epoch !== next?.epoch || previous?.actor.actorId !== next?.actor.actorId;
    workspaceRef.current = next;
    if (next) projectionClock.current.value += 1;
    setView(next);
    if (changedTable) {
      const pendingRules = next?.kind === 'table' && next.domain.kind === 'table' && viewerCan(next, 'rules.approve') && next.domain.candidate && next.domain.candidate.status !== 'active';
      // Chat-first tables open nothing until there is something to review (F006).
      const startObject = pendingRules ? 'table.rules' : null;
      setSelectedNodeId(startObject);
      setFocusNodeId(null);
      setOpenedObjectId(startObject);
      setFocusSourceIds([]);
      setDraftPrompt('');
      setAiPrefill(undefined);
      setRenameDraft(null);
    }
    if (previous?.id !== next?.id) {
      setInviteState(null);
      setInviteSeat(null);
      setPreviousInvitesRevoked(false);
    }
    if (next) {
      saveLastWorkspace(next.id);
      setPage('tables');
    }
  }, []);

  const showNotice = useCallback((text: string, tone: 'info' | 'error' | 'success' = 'info', action?: { label: string; run: () => void }) => {
    setNotice({ text, tone, ...(action ? { action } : {}) });
    if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current);
    // A notice with a button stays a little longer so it can be used.
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), action ? 15000 : 7000);
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
      const returnPath = takeReturnPath();
      const route = parseRoute(returnPath ?? window.location.pathname);
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
          rememberReturnPath(returnPath ?? window.location.pathname);
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
          setCapabilities({
            uploads: false,
            tableAssistant: { available: false, reason: 'Chat availability could not be checked. Refresh before starting a conversation; you can keep using the Canvas and reviewing rules.' },
            model: { enabled: false, reason: 'Feature access could not be checked. Refresh before adding files or requesting an AI draft.' },
          });
          showNotice('Feature access could not be checked. Uploads and AI requests are disabled until you refresh.', 'error');
          if (error instanceof ApiFailure && error.status === 401) {
            if (currentAuth?.mode === 'google') setAuthStatus({ ...currentAuth, authenticated: false, user: undefined });
            rememberReturnPath(returnPath ?? window.location.pathname);
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
            showNotice(isInviteLink(inviteTicket) ? `You joined ${joined.title}.` : `You joined ${joined.title}. This invitation is now used.`, 'success');
          } catch (error) {
            clearInviteFragment();
            clearPendingInvite();
            if (alive) showNotice(errorText(error), 'error');
          }
        } else if (route?.name === 'table') {
          try {
            const opened = await tabletopClient.workspace(route.id);
            if (alive) setWorkspace(opened);
          } catch (error) {
            if (error instanceof ApiFailure && error.status === 401) throw error;
            if (!alive) return;
            // Do not reveal whether the table exists; members and outsiders see the same notice.
            setPage('tables');
            showNotice('This table is not available to this account. Ask the table owner for an invitation.', 'error');
          }
        } else if (route?.name === 'new') {
          setPage('new');
        } else if (route?.name === 'tables' || route?.name === 'join') {
          // A new account has no list to show, so it goes straight to starting a table.
          setPage(currentSession.workspaces.length === 0 ? 'new' : 'tables');
        } else {
          // `/` and unknown paths show the landing page; the first URL sync rewrites unknown paths to `/`.
          setPage('landing');
        }
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401 && currentAuth?.mode === 'google') {
          rememberReturnPath(returnPath ?? window.location.pathname);
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
    if (starting) return;
    const target = routePath(view ? { name: 'table', id: view.id } : { name: page });
    const mode = urlSyncRef.current;
    urlSyncRef.current = 'push';
    if (mode === 'none' || window.location.pathname === target) return;
    // Pushed entries remember the app page before them, so "Your tables" can step back instead of stacking `/`.
    if (mode === 'replace') window.history.replaceState(window.history.state, document.title, target);
    else window.history.pushState({ tabletopFrom: window.location.pathname }, document.title, target);
  }, [view?.id, page, starting]);

  useEffect(() => {
    const followHistory = () => {
      const route = parseRoute(window.location.pathname);
      if (route?.name === 'table') {
        if (workspaceRef.current?.id === route.id) return;
        tabletopClient.workspace(route.id).then((opened) => {
          urlSyncRef.current = 'none';
          setWorkspace(opened);
        }, (error) => showNotice(errorText(error), 'error'));
      } else {
        const nextPage: AppPage = route?.name === 'new' ? 'new' : route?.name === 'tables' ? 'tables' : 'landing';
        if (!workspaceRef.current && pageRef.current === nextPage) return;
        urlSyncRef.current = 'none';
        setWorkspace(null);
        setPage(nextPage);
      }
    };
    window.addEventListener('popstate', followHistory);
    return () => window.removeEventListener('popstate', followHistory);
  }, [setWorkspace, showNotice]);

  const cursorStore = useMemo(() => createCursorStore(), []);
  // Bumped when another member's AI chat changes so the chat history reloads live (F015).
  const [assistantActivity, setAssistantActivity] = useState(0);
  const cursorSendRef = useRef<((point: { x: number; y: number } | null) => void) | null>(null);
  const liveCursors = useMemo(() => ({ store: cursorStore, send: (point: { x: number; y: number } | null) => cursorSendRef.current?.(point) }), [cursorStore]);
  useEffect(() => {
    if (!view) return;
    cursorStore.clear();
    const subscription = tabletopClient.subscribe(view.id, (next) => {
      if (workspaceRef.current?.id === next.id) setWorkspace(next);
    }, setConnection, (cursor) => { if (cursor) cursorStore.apply(cursor); else cursorStore.clear(); },
    () => setAssistantActivity((key) => key + 1));
    cursorSendRef.current = subscription.sendCursor;
    return () => { cursorSendRef.current = null; cursorStore.clear(); subscription(); };
  }, [view?.id, setWorkspace, cursorStore]);

  useEffect(() => () => { if (noticeTimerRef.current !== undefined) window.clearTimeout(noticeTimerRef.current); }, []);

  const compiled = useMemo((): { plan: ExecutablePlan | null; error: string | null } => {
    if (!view) return { plan: null, error: null };
    try { return { plan: planForWorkspace(view), error: null }; }
    catch (error) { return { plan: null, error: error instanceof Error ? error.message : 'The current table plan could not be rendered.' }; }
  }, [view]);

  const createWorkspace = useCallback(async (kind: CaseKind): Promise<WorkspaceView | null> => {
    if (kind === 'table' && capabilities.tableReadOnly) {
      showNotice('New shared tables are temporarily paused. You can still open existing tables and inspect their records.', 'info');
      setWorkspaceMenuOpen(false);
      return null;
    }
    setBusy('workspace.create');
    try {
      const next = await tabletopClient.createWorkspace(kind);
      // Tables are only created from /new; replace it so Back does not reopen the start page.
      urlSyncRef.current = 'replace';
      setWorkspace(next);
      await refreshSession();
      showNotice(`${caseInfo[kind].title} is ready.`, 'success');
      return next;
    } catch (error) {
      showNotice(errorText(error), 'error');
      return null;
    } finally { setBusy(null); setWorkspaceMenuOpen(false); }
  }, [capabilities.tableReadOnly, refreshSession, setWorkspace, showNotice]);

  const openStartPage = useCallback(() => {
    setWorkspaceMenuOpen(false);
    setWorkspace(null);
    setPage('new');
  }, [setWorkspace]);

  const leaveStartPage = useCallback(() => {
    if ((window.history.state as { tabletopFrom?: string } | null)?.tabletopFrom === routePath({ name: 'tables' })) {
      window.history.back();
      return;
    }
    urlSyncRef.current = 'replace';
    setPage('tables');
  }, []);

  const openTablesPage = useCallback(() => {
    setWorkspaceMenuOpen(false);
    setWorkspace(null);
    setPage('tables');
  }, [setWorkspace]);

  const openLandingPage = useCallback(() => {
    setWorkspaceMenuOpen(false);
    setWorkspace(null);
    setPage('landing');
  }, [setWorkspace]);

  // A typed description starts an empty shared table and waits in its rule draft;
  // nothing reaches the model until the owner consents; source files are optional.
  const startFromDescription = useCallback(async (description: string) => {
    const created = await createWorkspace('table');
    if (created) setAiPrefill({ text: description, key: Date.now() });
  }, [createWorkspace]);

  // F078-T5a: command submission and acknowledgement readback live in a typed seam
  // (`workspace/command-session.ts`). This component stays the composition root: it owns the
  // projection state, the busy marker, the notice copy and the invitation panels the seam calls
  // back into. The dependency arrays below keep the identity semantics the component had before
  // the extraction, so consumers that re-run on a changed callback re-run for the same reasons.
  const commands = useMemo(() => createWorkspaceCommandSession({
    client: tabletopClient,
    readWorkspace: () => workspaceRef.current,
    applyWorkspace: setWorkspace,
    writeWorkspaceRef: (next) => { workspaceRef.current = next; },
    projectionClock: projectionClock.current,
    capabilities: () => capabilitiesRef.current,
    setBusy,
    notify: showNotice,
    refreshSession,
    encodeBase64: fileToBase64,
    recordServerRoll,
    onWorkspaceReset: () => {
      setPreviousInvitesRevoked(true);
      setInviteState((previous) => previous ? { seat: previous.seat, invite: previous.invite, url: '', revoked: true } : null);
    },
  }), [refreshSession, setWorkspace, showNotice]);

  const runCommand = useCallback(
    (type: string, payload: unknown, expectedView?: WorkspaceView) => commands.runCommand(type, payload, expectedView),
    [commands],
  );

  const upload = useCallback(
    (kind: UploadKind, file: File) => commands.upload(kind, file),
    [commands],
  );

  const importTableFile = useCallback(
    (targetView: WorkspaceView, file: File) => commands.importTableFile(targetView, file),
    [commands],
  );

  const addWebSources = useCallback(
    (targetView: WorkspaceView, sources: AddableWebSource[]) => commands.addWebSources(targetView, sources),
    [commands],
  );

  // The AI callbacks stay in the composition root: they decide whether this seat may ask at all
  // and reject early with the same codes, while the server still validates every request.
  const requestAI = useCallback((targetView: WorkspaceView, prompt: string, sourceId: string | undefined, commandId: string): Promise<ModelJob> => {
    if (targetView.kind === 'table' && capabilities.tableReadOnly) return Promise.reject(new ApiFailure('AI proposals for shared tables are temporarily paused. Existing records and rules remain available to inspect.', 403, 'TABLE_READ_ONLY'));
    if (!capabilities.model.enabled) return Promise.reject(new ApiFailure('AI proposals are not enabled for this workspace.', 403));
    const roleAllowed = viewerCan(targetView, 'rules.draft');
    if (!roleAllowed) return Promise.reject(new ApiFailure('This seat cannot request an AI draft.', 403));
    return tabletopClient.requestModel(targetView, prompt, sourceId, commandId);
  }, [capabilities.model.enabled, capabilities.tableReadOnly]);

  const pollAI = useCallback((workspaceId: string, jobId: string) => tabletopClient.modelJob(workspaceId, jobId), []);

  const requestTableAssistant = useCallback((targetView: WorkspaceView, prompt: string, commandId: ReturnType<typeof crypto.randomUUID>, sameCommandRetry = false): Promise<TableAssistantJob> => {
    const current = workspaceRef.current;
    if (!current || !sameWorkspaceActor(current, targetView) || current.actor.role !== targetView.actor.role || current.kind !== 'table' || !['owner', 'participant'].includes(current.actor.role)) {
      return Promise.reject(new ApiFailure('This table seat changed. Open the current table before sending another request.', 409, 'STALE_EPOCH'));
    }
    if (capabilities.tableReadOnly) return Promise.reject(new ApiFailure('Assistant requests for this table are temporarily paused. Existing records and rules remain available to inspect.', 403, 'TABLE_READ_ONLY'));
    if (!capabilities.model.enabled) return Promise.reject(new ApiFailure('The table assistant is not enabled for this service.', 403));
    if (!sameCommandRetry && current.revision !== targetView.revision) return Promise.reject(new ApiFailure('The table changed. Review its current state and send your question again.', 409, 'STALE_REVISION'));
    // A retry carries the original snapshot and command ID. The server decides
    // whether it is an exact duplicate or a stale, previously unaccepted request.
    return tabletopClient.requestTableAssistant(targetView, prompt, commandId);
  }, [capabilities.model.enabled, capabilities.tableReadOnly]);

  const pollTableAssistant = useCallback((targetView: WorkspaceView, jobId: string): Promise<TableAssistantJob> => {
    if (!sameWorkspaceActor(workspaceRef.current, targetView)) return Promise.reject(new ApiFailure('This table seat changed. The response belongs to the previous seat.', 409, 'STALE_EPOCH'));
    return tabletopClient.tableAssistantJob(targetView.id, jobId);
  }, []);

  const loadTableAssistantHistory = useCallback((targetView: WorkspaceView, before?: string): Promise<TableAssistantHistoryPage> => {
    if (!sameWorkspaceActor(workspaceRef.current, targetView)) return Promise.reject(new ApiFailure('This table seat changed. Its assistant history belongs to the previous seat.', 409, 'STALE_EPOCH'));
    return tabletopClient.tableAssistantHistory(targetView.id, before, 20);
  }, []);

  const confirmTableAssistantAction = useCallback(
    (targetView: WorkspaceView, job: TableAssistantJob, commandId: ReturnType<typeof crypto.randomUUID>) => commands.confirmTableAssistantAction(targetView, job, commandId, busy !== null),
    [busy, commands],
  );

  const loadAdminWorkspaces = useCallback((after?: string) => tabletopClient.adminWorkspaces(after), []);

  const refreshWorkspaceProjection = useCallback(
    (workspaceId: string) => commands.refreshWorkspaceProjection(workspaceId),
    [commands],
  );

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

  // F003-T1: the table owner removes a member; their access ends at once.
  const removeMember = useCallback(async (actorId: string) => {
    const current = workspaceRef.current;
    if (!current) return;
    const name = current.members.find((member) => member.actorId === actorId)?.name ?? 'This person';
    setInviteBusy(true);
    try {
      const next = await tabletopClient.removeMember(current.id, actorId);
      if (workspaceRef.current?.id === next.id) setWorkspace(next);
      showNotice(`${name} was removed from the table. They need a new invitation to come back.`, 'success');
    } catch (error) { showNotice(errorText(error), 'error'); }
    finally { setInviteBusy(false); }
  }, [setWorkspace, showNotice]);

  const createInvite = useCallback(async (seat: Seat, replaceOutstanding = false) => {
    const current = workspaceRef.current;
    if (!current) return;
    if (current.kind === 'table' && capabilities.tableReadOnly) {
      showNotice('Invitations for shared tables are temporarily paused. Current members can still inspect the table.', 'info');
      return;
    }
    setInviteBusy(true);
    try {
      const invite = await tabletopClient.invite(current.id, seat, replaceOutstanding);
      const url = new URL(routePath({ name: 'join' }), window.location.origin);
      url.hash = new URLSearchParams({ invite: invite.ticket }).toString();
      setInviteState({ seat, invite, url: url.toString() });
      setPreviousInvitesRevoked(false);
      setInviteSeat(seat);
      setCopied(false);
      showNotice(`${replaceOutstanding ? 'The previous unused link is revoked. ' : ''}A single-use invitation for ${seatLabel(seat)} is ready.`, 'success');
    } catch (error) { showNotice(errorText(error), 'error'); }
    finally { setInviteBusy(false); }
  }, [capabilities.tableReadOnly, showNotice]);

  const openInviteDialog = useCallback(() => {
    setInviteOpen(true);
    setInviteSeat(null);
    setCopied(false);
  }, []);

  const requestCanvasFocus = useCallback((nodeId: string, open = true) => {
    setSelectedNodeId(nodeId);
    setFocusNodeId(nodeId);
    setFocusRequestKey((key) => key + 1);
    if (open) setOpenedObjectId(nodeId);
  }, []);

  const focusEvidence = useCallback((sourceIds: string[]) => {
    if (!view || view.kind !== 'invoice') return;
    setFocusSourceIds(sourceIds);
    requestCanvasFocus('invoice.source');
  }, [requestCanvasFocus, view]);

  const backFromEvidence = useCallback(() => {
    setFocusSourceIds([]);
    requestCanvasFocus('invoice.table');
  }, [requestCanvasFocus]);

  const selectCanvasNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
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

  const tableChat = useTableChat({
    view,
    aiEnabled: capabilities.model.enabled,
    assistantAvailable: capabilities.tableAssistant?.available === true,
    computeCapabilities: capabilities.compute,
    readOnly: capabilities.tableReadOnly === true,
    busy: busy !== null,
    requestDraft: (target, prompt, commandId) => requestAI(target, prompt, undefined, commandId),
    pollDraft: pollAI,
    refresh: refreshWorkspaceProjection,
    ask: requestTableAssistant,
    pollAsk: pollTableAssistant,
    loadHistory: (target) => loadTableAssistantHistory(target),
    loadDraftHistory: (target) => tabletopClient.modelHistory(target.id),
    historyRefreshKey: assistantActivity,
    confirm: confirmTableAssistantAction,
    attach: importTableFile,
    webEvidence: capabilities.webEvidence === true,
    addWebSources,
    focusObject: requestCanvasFocus,
    notify: showNotice,
    prefill: aiPrefill,
    // F076: notes and pictures live in the composer's + menu; pictures wait in the composer until sent.
    composerTools: view && isTableWorkspaceView(view) && capabilities.tableReadOnly !== true ? {
      onAddNote: () => addNote(view, runCommand),
      noteDisabledReason: noteLimitReason(view),
      ...(capabilities.images ? {
        onPinImages: (images: readonly File[], caption: string) => pinImages(view, images, caption, runCommand, (image) => tabletopClient.uploadCanvasImage(view, image)),
        imagesLeft: imagesLeft(view),
      } : {}),
    } : undefined,
  });

  if (starting) return <LoadingScreen />;
  if (authStatus?.mode === 'google' && !authStatus.authenticated) return <AccountSignIn status={authStatus} notice={notice} hasPendingInvite={Boolean(readPendingInvite() || inviteFromFragment())} checking={false} onRetry={retryBootstrap} onDismissNotice={() => setNotice(null)} />;
  if (!session) return <FailureScreen onRetry={retryBootstrap} notice={notice} />;
  const headerAccount = accountForHeader(authStatus, session);
  if (!view && page === 'new') return <StartPage
    header={<ChooserHeader session={session} account={headerAccount} busy={busy} onSignOut={() => void signOut()} onLoadAdminWorkspaces={loadAdminWorkspaces} onHome={openLandingPage} onOpenTables={openTablesPage} />}
    notice={<NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}
    busy={busy !== null}
    tableReadOnly={capabilities.tableReadOnly === true}
    renderIcon={(kind) => <CaseIcon kind={kind} />}
    onChooseStarter={(kind) => void createWorkspace(kind)}
    onDescribe={(description) => void startFromDescription(description)}
    onStartEmpty={() => void createWorkspace('table')}
    onBack={leaveStartPage}
  />;
  if (!view && page === 'landing') return <SignedInWelcome user={headerAccount} busy={busy === 'auth.logout'} onOpenTables={openTablesPage} onStart={openStartPage} onSignOut={() => void signOut()} onLoadAdminWorkspaces={loadAdminWorkspaces} />;
  if (!view) return <WorkspaceChooser session={session} account={headerAccount} onHome={openLandingPage} onLoadAdminWorkspaces={loadAdminWorkspaces} busy={busy} tableReadOnly={capabilities.tableReadOnly === true} notice={notice} onDismissNotice={() => setNotice(null)} onSignOut={() => void signOut()} onStart={openStartPage} onOpen={(id) => void openWorkspace(id)} />;

  const selectedNode = compiled.plan?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const tableReadOnly = view.kind === 'table' && capabilities.tableReadOnly === true;
  const canInvite = view.kind !== 'invoice' && viewerCan(view, 'members.invite') && !(view.kind === 'table' && tableReadOnly);
  const canReset = ['owner', 'teacher', 'dm'].includes(view.actor.role) && !tableReadOnly;
  const canRename = canReset;
  const submitRename = () => {
    if (renameDraft === null) return;
    const title = normalizeWorkspaceTitle(renameDraft);
    if (title === null) {
      showNotice(`A table name needs 1 to ${WORKSPACE_TITLE_MAX_CHARS} characters without line breaks.`, 'error');
      return;
    }
    setRenameDraft(null);
    if (title === workspaceLabel(view)) return;
    void runCommand('workspace.rename', { title }).then((renamed) => { if (renamed) showNotice(`Table renamed to ${title}.`, 'success'); });
  };
  const canAskAI = viewerCan(view, 'rules.draft');
  const connectedSeats = new Set(view.members.map((member) => member.seat).filter(Boolean));
  // The Worker reports how many member seats it hands out; the Node guest runtime keeps seven.
  const runtimeMemberSeats = capabilities.memberSeats ?? NODE_TABLE_MEMBER_SEATS;
  const memberLimit = tableMemberSeatLimit(view.domain.display, runtimeMemberSeats);
  const seatedMembers = view.members.filter((member) => member.seat?.startsWith('member-')).length;
  const inviteSeats: Seat[] = view.kind === 'teaching' ? ['learner-1', 'learner-2'] : view.kind === 'encounter' ? ['mira', 'pip'] : view.kind === 'table' ? TABLE_MEMBER_SEATS.slice(0, runtimeMemberSeats) : [];
  const inviteIsHeld = inviteState !== null && !inviteState.revoked && inviteState.invite.expiresAt > Date.now() && !connectedSeats.has(inviteState.seat);
  const freeInviteSeats = inviteSeats.filter((seat) => !connectedSeats.has(seat) && !(inviteIsHeld && inviteState?.seat === seat));
  // A table offers only as many free seats as its member limit still leaves open.
  const remainingInviteSeats = view.kind === 'table' ? freeInviteSeats.slice(0, Math.max(0, memberLimit - seatedMembers)) : freeInviteSeats;
  const aiContent = canAskAI && view.kind !== 'table' && !tableReadOnly ? <AIProposal view={view} capabilities={capabilities} onRequest={requestAI} onPoll={pollAI} onRefresh={refreshWorkspaceProjection} prefill={aiPrefill} /> : undefined;
  // The runtime owns Files/Rules visibility. Keep a truly empty table free of
  // default cards while still allowing its private chat answers to materialize.
  const chatVisibleIds = isTableWorkspaceView(view) && compiled.plan?.nodes.length === 0
    ? tableChat.cards.map((card) => card.id)
    : undefined;
  const surfaceBusy = tableReadOnly ? 'table.readOnly' : busy;

  return (
    <LiveCursorProvider value={liveCursors}>
    <UploadCapabilityProvider enabled={capabilities.uploads} reason={capabilities.uploads ? '' : 'File uploads are disabled for this service. Manual editing remains available.'}>
    <div className="tt-app" data-workspace-kind={view?.kind}>
      <header className="tt-topbar">
        <a className="tt-brand" href="/" aria-label="Tabletop home" onClick={(event) => { event.preventDefault(); openLandingPage(); }}><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></a>
        <span className="tt-topbar__divider" aria-hidden="true" />
        <div className="tt-workspace-picker">
          {renameDraft !== null ? <form className="tt-table-rename" onSubmit={(event) => { event.preventDefault(); submitRename(); }}>
            <label className="tt-visually-hidden" htmlFor="tt-table-rename-input">Table name</label>
            <input id="tt-table-rename-input" value={renameDraft} maxLength={WORKSPACE_TITLE_MAX_CHARS} autoFocus onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setRenameDraft(null); } }}
              onBlur={submitRename} />
          </form> : <>
            <button type="button" className="tt-workspace-picker__button" aria-label={`Tables: ${workspaceLabel(view)}`} aria-haspopup="menu" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen((open) => !open)}><span><strong>{workspaceLabel(view)}</strong></span><ChevronDown size={15} /></button>
            {canRename && <button type="button" className="tt-table-rename-trigger" aria-label="Rename table" title="Rename table" disabled={busy !== null} onClick={() => { setWorkspaceMenuOpen(false); setRenameDraft(workspaceLabel(view)); }}><Pencil size={14} /></button>}
          </>}
          {workspaceMenuOpen && <>
            <button className="tt-menu-dismiss" type="button" aria-label="Close table menu" onClick={() => setWorkspaceMenuOpen(false)} />
            <div className="tt-workspace-menu" role="menu"><span className="tt-kicker">YOUR TABLES</span>{session.workspaces.map((item) => <button role="menuitem" type="button" className={item.id === view.id ? 'is-current' : ''} key={item.id} onClick={() => void openWorkspace(item.id)}><CaseIcon kind={item.kind} /><span><strong>{item.title}</strong><small>{caseInfo[item.kind].title} · {item.role}</small></span>{item.id === view.id && <Check size={14} />}</button>)}<button role="menuitem" type="button" onClick={openTablesPage}><ArrowLeft size={15} /><span><strong>All tables</strong><small>See every table you own or joined</small></span></button><hr /><span className="tt-kicker">START A TABLE</span><button role="menuitem" type="button" onClick={openStartPage}><Plus size={15} /><span><strong>New table</strong><small>Choose a prepared table or describe your own</small></span><ArrowRight size={14} /></button><hr /><a role="menuitem" className="tt-workspace-menu__demo" href="/demo" target="_blank" rel="noopener" aria-label="Auto demo (opens in a new tab)"><Play size={15} fill="currentColor" /><span><strong>Auto demo</strong><small>Opens in a new tab</small></span><ArrowRight size={14} /></a></div>
          </>}
        </div>
        <div className="tt-topbar__spacer" />
        <div className="tt-connection" data-state={connection} role="status" title="Live connection status"><i aria-hidden="true" /><span>{connection === 'connected' ? 'Live' : connection === 'connecting' ? 'Connecting' : connection === 'offline' ? 'Offline' : 'Reconnecting'}</span></div>
        {view.kind !== 'invoice' && <HeaderPeople members={view.members} selfId={view.actor.actorId} store={cursorStore} onOpenPeople={() => requestCanvasFocus(DEFAULT_CANVAS_AUXILIARY_IDS.people)} />}
        {canInvite && <button type="button" className="tt-button tt-button--quiet tt-invite-button" onClick={openInviteDialog}><Plus size={14} /> Invite</button>}
        <details className="tt-table-options"><summary aria-label="Table options"><MoreHorizontal size={20} /></summary><div className="tt-table-options__body">
          <a href="/demo" target="_blank" rel="noopener"><Play size={15} />Try a demo</a>
          <button type="button" disabled={busy !== null} onClick={() => void openWorkspace(view.id)}><RefreshCw size={15} />Refresh table</button>
          {canReset && <button type="button" onClick={() => setResetOpen(true)}><RotateCcw size={15} />Reset table</button>}
          <DisplaySettings view={view} disabled={busy !== null || tableReadOnly} onCommand={runCommand} />
          <small>{view.actor.role} · rules r{view.domain.ruleRevision} · data r{view.domain.dataRevision}</small>
          {headerAccount && <AccountBadge user={headerAccount} busy={busy === 'auth.logout'} onSignOut={() => void signOut()} onLoadAdminWorkspaces={loadAdminWorkspaces} />}
        </div></details>
      </header>

      {tableReadOnly && <div className="tt-notice tt-notice--info tt-table-readonly-notice" role="status"><span><ShieldCheck size={15} /></span><p>Editing this shared table is temporarily paused. Existing records and rules remain available to inspect.</p></div>}

      {notice && <div className={`tt-notice tt-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.tone === 'error' ? <CircleAlert size={15} /> : notice.tone === 'success' ? <Check size={15} /> : <Activity size={15} />}</span><p>{notice.text}</p>{notice.action && <button type="button" className="tt-notice__action" onClick={() => { notice.action?.run(); setNotice(null); }}>{notice.action.label}</button>}<button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={14} /></button></div>}

      <TableSurface
        view={view}
        plan={compiled.plan}
        planError={compiled.error}
        surface="canvas"
        selectedNodeId={selectedNodeId}
        onSelectNode={selectCanvasNode}
        onCommand={runCommand}
        busy={surfaceBusy}
        onUpload={upload}
        onTableImport={tableReadOnly ? undefined : importTableFile}
        onExport={download}
        onFocusEvidence={focusEvidence}
        onBackFromEvidence={backFromEvidence}
        focusSourceIds={focusSourceIds}
        inspectorScrollRef={inspectorScrollRef}
        onReload={() => void openWorkspace(view.id)}
        onInvite={canInvite ? openInviteDialog : undefined}
        onFocusObject={requestCanvasFocus}
        aiContent={aiContent}
        auxiliaryObjects={isTableWorkspaceView(view) ? tableChat.cards : undefined}
        visibleNodeIds={chatVisibleIds}
        promptContent={isTableWorkspaceView(view) ? tableChat.bar : aiContent && capabilities.model.enabled ? <form className="tt-canvas-composer" onSubmit={(event) => { event.preventDefault(); if (!draftPrompt.trim()) return; setAiPrefill({ text: draftPrompt.trim(), key: Date.now() }); setDraftPrompt(''); requestCanvasFocus(DEFAULT_CANVAS_AUXILIARY_IDS.ai); }}><label className="tt-visually-hidden" htmlFor="tt-canvas-change-prompt">Describe a rule change</label><input id="tt-canvas-change-prompt" value={draftPrompt} maxLength={1200} onChange={(event) => setDraftPrompt(event.target.value)} placeholder="What would you like to change?" /><button type="submit" aria-label="Prepare a change" disabled={!draftPrompt.trim()}><Send size={17} /></button><small>Review a draft before using it.</small></form> : undefined}
        focusNodeId={focusNodeId}
        focusRequestKey={focusRequestKey}
        openedObjectId={openedObjectId}
        onOpenObject={setOpenedObjectId}
        onEditRules={viewerCan(view, 'rules.draft') && capabilities.model.enabled && !tableReadOnly ? tableChat.editRules : undefined}
        inspectorContent={<>
          {selectedNode && compiled.plan && <ObjectInspector node={selectedNode} plan={compiled.plan} onClose={() => setSelectedNodeId(null)} />}
        </>}
      />

      {inviteOpen && <InviteDialog view={view} availableSeats={remainingInviteSeats} canInvite={canInvite} busy={inviteBusy} invite={inviteState} previousInvitesRevoked={previousInvitesRevoked} copied={copied} onSelectSeat={setInviteSeat} selectedSeat={inviteSeat} onCreate={(seat, replace) => void createInvite(seat, replace)} onCopy={() => void copyInvite()} onClose={() => setInviteOpen(false)} onRemoveMember={view.kind === 'table' && viewerCan(view, 'members.remove') && !tableReadOnly ? (actorId) => void removeMember(actorId) : undefined} onInviteLinkNotice={view.kind === 'table' && canInvite && capabilities.inviteLinks ? showNotice : undefined} linkInvites={view.kind === 'table' && capabilities.inviteLinks === true} onAccessCommand={(type, payload) => runCommand(type, payload)} memberLimit={memberLimit} runtimeMemberSeats={runtimeMemberSeats} onSetMemberLimit={view.kind === 'table' && canInvite && !tableReadOnly ? (maxMembers) => void runCommand('display.set', { maxMembers }) : undefined} />}
      {resetOpen && <ConfirmDialog title="Reset this table?" confirmLabel="Reset table" busy={busy === 'workspace.reset'} onClose={() => setResetOpen(false)} onConfirm={() => void beginReset()}><p>This clears the current table contents, drafts, and unresolved actions. Existing invitation links and member access are revoked. You will keep your table role.</p><p>The reset creates a new table revision and cannot be undone.</p></ConfirmDialog>}
    </div>
    </UploadCapabilityProvider>
    </LiveCursorProvider>
  );
}


function FailureScreen({ notice, onRetry }: { notice: { text: string; tone: 'info' | 'error' | 'success' } | null; onRetry: () => void }) {
  return <main className="tt-failure"><span className="tt-dialog__mark"><CircleAlert size={18} /></span><p className="tt-kicker">TABLETOP</p><h1>The table could not be opened</h1><p>{notice?.text ?? 'Check your connection and try again.'}</p><button type="button" className="tt-button tt-button--primary" onClick={onRetry}><RefreshCw size={14} /> Try again</button></main>;
}

function ChooserHeader({ session, account, busy, onSignOut, onLoadAdminWorkspaces, onHome, onOpenTables }: { session: SessionView; account: GoogleAuthUser | null; busy: string | null; onSignOut: () => void; onLoadAdminWorkspaces: (after?: string) => Promise<AdminWorkspacePage>; onHome?: () => void; onOpenTables?: () => void }) {
  return <header className="tt-chooser__top"><a className="tt-brand" href="/" aria-label="Tabletop home" onClick={(event) => { event.preventDefault(); onHome?.(); }}><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></a><a className="tt-chooser-demo-link" href="/demo" target="_blank" rel="noopener" aria-label="Auto demo (opens in a new tab)"><Play size={13} fill="currentColor" /><span>Auto demo</span><small>↗</small></a>{account ? <AccountMenu user={account} busy={busy === 'auth.logout'} onOpenTables={onOpenTables} onSignOut={onSignOut} onLoadAdminWorkspaces={onLoadAdminWorkspaces} /> : <span className="tt-session-name">Signed in as {session.name}</span>}</header>;
}

function NoticeBanner({ notice, onDismiss }: { notice: { text: string; tone: 'info' | 'error' | 'success' } | null; onDismiss: () => void }) {
  if (!notice) return null;
  return <div className={`tt-notice tt-notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><span>{notice.tone === 'error' ? <CircleAlert size={15} /> : <Activity size={15} />}</span><p>{notice.text}</p><button type="button" aria-label="Dismiss message" onClick={onDismiss}><X size={14} /></button></div>;
}

function WorkspaceChooser({ session, account, onHome, onLoadAdminWorkspaces, busy, tableReadOnly, notice, onDismissNotice, onSignOut, onStart, onOpen }: { session: SessionView; account: GoogleAuthUser | null; onHome: () => void; onLoadAdminWorkspaces: (after?: string) => Promise<AdminWorkspacePage>; busy: string | null; tableReadOnly: boolean; notice: { text: string; tone: 'info' | 'error' | 'success' } | null; onDismissNotice: () => void; onSignOut: () => void; onStart: () => void; onOpen: (id: string) => void }) {
  const lastId = readLastWorkspace();
  const [filter, setFilter] = useState<TableListFilter>(() => ({ ...NO_TABLE_FILTER, sort: readTableSort() }));
  const query = filter.query;
  const setQuery = (value: string) => setFilter((current) => ({ ...current, query: value }));
  const now = Date.now();
  // Newest first under the chosen clock (F053); "Last opened" stays a label and does not jump the order.
  const visibleWorkspaces = filterTables(session.workspaces, filter, now, (kind) => caseInfo[kind].title);
  const presentKinds = [...new Set(session.workspaces.map((workspace) => workspace.kind))];
  const hasTimes = session.workspaces.some((workspace) => workspace.updatedAt !== undefined);
  // Clearing the filters keeps the sort, which is a preference rather than a filter.
  const clearFilters = () => setFilter((current) => ({ ...NO_TABLE_FILTER, sort: current.sort }));
  const changeSort = (sort: TableSort) => { setFilter((current) => ({ ...current, sort })); saveTableSort(sort); };
  return <main className="tt-chooser"><ChooserHeader session={session} account={account} busy={busy} onSignOut={onSignOut} onLoadAdminWorkspaces={onLoadAdminWorkspaces} onHome={onHome} />
    <NoticeBanner notice={notice} onDismiss={onDismissNotice} />
    <section className="tt-chooser__content"><h1>What are you here to do?</h1><p>Start with what you're working on. Your table will take shape around it.</p>
      <button className="tt-start-own-table" type="button" disabled={busy !== null} onClick={onStart}><Plus size={18} />Start a new table</button>
      {tableReadOnly && <p role="status">New shared tables are temporarily paused. You can still open a prepared table or an existing one.</p>}
      {session.workspaces.length > 0 && <div className="tt-existing-tables">
        <div className="tt-existing-tables__head">
          <h2>Pick up where you left off</h2>
          <label className="tt-table-search"><Search size={14} aria-hidden="true" /><span className="tt-visually-hidden">Search your tables</span><input type="search" value={query} placeholder="Search tables" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }} /></label>
        </div>
        {session.workspaces.length > 1 && <div className="tt-table-filters" role="group" aria-label="Filter tables">
          <label><span>Sort</span><select value={filter.sort} onChange={(event) => changeSort(event.target.value as TableSort)}>
            <option value="updated">Last updated</option>
            <option value="created">Created</option>
          </select></label>
          {presentKinds.length > 1 && <label><span>Type</span><select value={filter.kind} onChange={(event) => setFilter((current) => ({ ...current, kind: event.target.value as TableListFilter['kind'] }))}>
            <option value="all">All types</option>
            {presentKinds.map((kind) => <option key={kind} value={kind}>{caseInfo[kind].title}</option>)}
          </select></label>}
          <label><span>Role</span><select value={filter.ownership} onChange={(event) => setFilter((current) => ({ ...current, ownership: event.target.value as TableOwnership }))}>
            <option value="all">Any role</option>
            <option value="mine">Created by me</option>
            <option value="joined">Joined</option>
          </select></label>
          {hasTimes && <label><span>Updated</span><select value={filter.recency} onChange={(event) => setFilter((current) => ({ ...current, recency: event.target.value as TableRecency }))}>
            <option value="any">Any time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
          </select></label>}
          {isFiltered(filter) && <button type="button" className="tt-table-filters__clear" onClick={clearFilters}><X size={13} aria-hidden="true" />Clear</button>}
          <small className="tt-table-filters__count" role="status">{visibleWorkspaces.length} of {session.workspaces.length}</small>
        </div>}
        {visibleWorkspaces.map((workspace) => {
          const updatedAt = workspace.updatedAt;
          return <button type="button" key={workspace.id} onClick={() => onOpen(workspace.id)} disabled={busy !== null}><CaseIcon kind={workspace.kind} /><span><strong>{workspace.title}</strong><small>{workspace.id === lastId ? 'Last opened · ' : ''}{caseInfo[workspace.kind].title} · {workspace.role}</small></span>
            {updatedAt !== undefined && <span className="tt-existing-tables__times">
              {updatedAt !== undefined && <time className="tt-existing-tables__updated" dateTime={new Date(updatedAt).toISOString()} title={`Last changed ${new Date(updatedAt).toLocaleString()}`}><b>{workspace.updatedBy ? `Updated by ${workspace.updatedBy}` : 'Updated'}</b><span>{listDate(updatedAt, now)} · {relativeTime(updatedAt, now)}</span></time>}
            </span>}
            <ArrowRight size={16} />
          </button>;
        })}
        {visibleWorkspaces.length === 0 && <p className="tt-existing-tables__empty" role="status">{query.trim() ? `No tables match “${query.trim()}”` : 'No tables match these filters'}. <button type="button" className="tt-table-filters__clear" onClick={clearFilters}>Clear filters</button></p>}
      </div>}
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

function InviteDialog({ view, availableSeats, canInvite, busy, invite, previousInvitesRevoked, copied, onSelectSeat, selectedSeat, onCreate, onCopy, onClose, onRemoveMember, onInviteLinkNotice, linkInvites = false, onAccessCommand, memberLimit, runtimeMemberSeats, onSetMemberLimit }: { view: WorkspaceView; availableSeats: Seat[]; canInvite: boolean; busy: boolean; invite: InviteState; previousInvitesRevoked: boolean; copied: boolean; onSelectSeat: (seat: Seat | null) => void; selectedSeat: Seat | null; onCreate: (seat: Seat, replaceOutstanding?: boolean) => void; onCopy: () => void; onClose: () => void; onRemoveMember?: (actorId: string) => void; onInviteLinkNotice?: (text: string, tone: 'success' | 'error' | 'info') => void; linkInvites?: boolean; onAccessCommand?: (type: 'access.saveRole' | 'access.deleteRole' | 'access.assign', payload: unknown) => Promise<unknown>; memberLimit: number; runtimeMemberSeats: number; onSetMemberLimit?: (maxMembers: number | null) => void }) {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // The owner can never be removed; under equal permissions (F015) members may remove other members.
  const removable = onRemoveMember ? view.members.filter((member) => member.actorId !== view.actor.actorId && member.role !== 'owner') : [];
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
    <span className="tt-dialog__mark"><Users size={17} /></span><h2 id="tt-invite-title">People at this table</h2><p>{linkInvites ? `Anyone with the invite link can join while it is on, up to ${memberLimit} ${memberLimit === 1 ? 'member' : 'members'}. Remove someone to end their access.` : 'Only invited seats can join. Each invitation works once and expires after ten minutes.'}</p><MemberStrip view={view} />
    {view.kind === 'table' && <MemberLimit view={view} limit={memberLimit} runtimeSeats={runtimeMemberSeats} disabled={busy} onChange={onSetMemberLimit} />}
    {onInviteLinkNotice && <InviteLinkPanel workspaceId={view.id} epoch={view.epoch} disabled={busy} onNotice={onInviteLinkNotice} />}
    {removable.length > 0 && <ul className="tt-member-manage" aria-label="Members">
      {removable.map((member) => <li key={member.actorId}>
        {confirmRemove === member.actorId
          ? <><span>Remove <strong>{member.name}</strong>? They lose access now and need a new invitation to return.</span>
            <button type="button" className="tt-button tt-button--danger" disabled={busy} onClick={() => { setConfirmRemove(null); onRemoveMember?.(member.actorId); }}>Remove</button>
            <button type="button" className="tt-button tt-button--quiet" disabled={busy} onClick={() => setConfirmRemove(null)}>Cancel</button></>
          : <><span>{member.name}{member.seat ? <small> · {seatLabel(member.seat)}</small> : null}</span>
            <button type="button" className="tt-button tt-button--quiet" disabled={busy} aria-label={`Remove ${member.name}`} onClick={() => setConfirmRemove(member.actorId)}>Remove</button></>}
      </li>)}
    </ul>}
    {onAccessCommand && <RoleSettings view={view} busy={busy} onCommand={onAccessCommand} />}
    {previousInvitesRevoked && <div className="tt-invite-status tt-invite-status--revoked"><ShieldCheck size={15} /><span><strong>Previous invitation links revoked</strong><small>The table reset invalidated links and removed the previous members.</small></span></div>}
    {!linkInvites && (invite && !invite.revoked && activeMember ? <div className="tt-invite-status tt-invite-status--joined"><Check size={15} /><span><strong>{activeMember.name} joined as {seatLabel(invite.seat)}</strong><small>This one-use invitation has been accepted.</small></span></div> : invite && !invite.revoked && expired ? <div className="tt-invite-status tt-invite-status--expired"><CircleAlert size={15} /><span><strong>Invitation expired</strong><small>Create a new one for this seat.</small></span></div> : invite && !invite.revoked ? <div className="tt-invite-created"><div className="tt-invite-status"><Activity size={15} /><span><strong>Waiting for {seatLabel(invite.seat)}</strong><small>Expires {new Date(invite.invite.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span></div><label htmlFor="tt-invite-link">One-use invitation link</label><div className="tt-invite-link-row"><input id="tt-invite-link" value={invite.url} readOnly onFocus={(event) => event.currentTarget.select()} /><button type="button" className="tt-button tt-button--primary" onClick={onCopy}><Clipboard size={14} /> {copied ? 'Copied' : 'Copy link'}</button></div><small>The link is held only in this open panel. Send it to the person taking this seat.</small></div> : null)}
    {!linkInvites && (canInvite ? <div className={view.kind === 'table' ? 'tt-invite-choose tt-invite-choose--compact' : 'tt-invite-choose'}><span className="tt-kicker">AVAILABLE SEATS</span>{seatChoices.length === 0 ? <p>{view.kind === 'table' ? `All ${memberLimit} member ${memberLimit === 1 ? 'seat is' : 'seats are'} filled. Raise the member limit or remove someone to invite more people.` : 'All supported seats are filled. Reset a table to revoke access or choose another table.'}</p> : seatChoices.map((seat) => <button type="button" className={selectedSeat === seat ? 'is-selected' : ''} key={seat} onClick={() => onSelectSeat(seat)}><span><strong>{seatLabel(seat)}</strong><small>{view.kind === 'teaching' ? 'Learner view and private answer' : view.kind === 'encounter' ? 'Player view and character actions' : 'Shared active records and table actions'}</small></span>{selectedSeat === seat ? <Check size={14} /> : <ArrowRight size={14} />}</button>)}</div> : <div className="tt-invite-status"><Users size={15} /><span><strong>Table members</strong><small>{view.kind === 'table' ? 'Only the table owner can send invitations.' : 'Only the teacher or Dungeon Master can send invitations.'}</small></span></div>)}
    {!linkInvites && canInvite && selectedSeat && !view.members.some(member => member.seat === selectedSeat) && <details className="tt-invite-recovery"><summary>Lost an unused invitation link?</summary><p>Replace the link for {seatLabel(selectedSeat)}. Any previous unused link for this seat will stop working.</p><button type="button" className="tt-button tt-button--quiet" disabled={busy} onClick={() => onCreate(selectedSeat, true)}>Revoke old link and issue new link</button></details>}
    <footer><button ref={closeButtonRef} type="button" className="tt-button tt-button--quiet" onClick={onClose}>Close</button>{!linkInvites && canInvite && selectedSeat && (!invite || invite.seat !== selectedSeat || expired || invite.revoked || activeMember) && <button ref={createButtonRef} type="button" className="tt-button tt-button--primary" disabled={busy || view.members.some(member => member.seat === selectedSeat)} onClick={() => onCreate(selectedSeat)}>{busy ? <LoaderCircle size={14} className="tt-spin" /> : <Plus size={14} />} Create invitation for {seatLabel(selectedSeat)}</button>}</footer>
  </section></div>;
}

/** Seats in use against the table's member limit, with the limit picker for people who may invite. */
function MemberLimit({ view, limit, runtimeSeats, disabled, onChange }: { view: WorkspaceView; limit: number; runtimeSeats: number; disabled: boolean; onChange?: (maxMembers: number | null) => void }) {
  const seated = view.members.filter((member) => member.seat?.startsWith('member-')).length;
  const configured = view.domain.display?.maxMembers;
  const value = configured === undefined ? 'max' : String(Math.min(configured, runtimeSeats));
  return <div className="tt-member-limit">
    <p className="tt-member-count" aria-label="Seats in use">{seated}/{limit} members</p>
    {onChange && <span className="tt-member-limit__control"><label htmlFor="tt-member-limit">Member limit</label>
      <select id="tt-member-limit" value={value} disabled={disabled} title="How many people can join besides the owner. Lowering it never removes anyone." onChange={(event) => {
        const next = event.target.value;
        onChange(next === 'max' ? null : Number(next));
      }}>
        <option value="max">Maximum ({runtimeSeats})</option>
        {Array.from({ length: runtimeSeats }, (_, index) => index + 1).map((count) => <option key={count} value={String(count)}>{count}</option>)}
      </select>
    </span>}
    {seated > limit && <small>{seated} people are already here, above the limit of {limit}. No one is removed; new people can join once fewer than {limit} remain.</small>}
  </div>;
}

function seatLabel(seat: Seat): string {
  if (seat === 'learner-1') return 'Learner 1';
  if (seat === 'learner-2') return 'Learner 2';
  if (seat === 'mira') return 'Mira';
  if (seat === 'pip') return 'Pip';
  return `Member ${seat.slice('member-'.length)}`;
}

/** Table-wide display settings in the table options menu. Changes apply to everyone at this table. */
function DisplaySettings({ view, disabled, onCommand }: { view: WorkspaceView; disabled: boolean; onCommand: (type: string, payload: unknown) => Promise<unknown> }) {
  const canEdit = viewerCan(view, 'table.rename');
  const connections = view.domain.display?.connections;
  const value = connections === undefined ? 'auto' : connections ? 'on' : 'off';
  return <section className="tt-display-settings" aria-label="Display settings">
    <span className="tt-kicker">DISPLAY · THIS TABLE</span>
    <label>Connection lines
      <select value={value} disabled={disabled || !canEdit} title={canEdit ? 'Applies to everyone at this table' : 'Your role cannot change this table\'s display'} onChange={(event) => {
        const next = event.target.value;
        void onCommand('display.set', { connections: next === 'auto' ? null : next === 'on' });
      }}>
        <option value="auto">Automatic</option>
        <option value="on">Show</option>
        <option value="off">Hide</option>
      </select>
    </label>
  </section>;
}
