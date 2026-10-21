import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, LoaderCircle, RefreshCw } from 'lucide-react';
import { INVITE_LINK_PREFIX, tabletopClient, type InviteLinkStatus } from '../client';
import { routePath } from '../routes';

type Days = 1 | 7 | 30;
const DAY_CHOICES: readonly Days[] = [1, 7, 30];

/** The raw link is shown only when created; this tab remembers it while it stays open (F003-T3). */
function cacheKey(workspaceId: string, epoch: number): string { return `tabletop.inviteLink.${workspaceId}.${epoch}`; }
function readCached(workspaceId: string, epoch: number): { url: string; expiresAt: number } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(cacheKey(workspaceId, epoch)) ?? 'null') as unknown;
    if (value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string' && typeof (value as { expiresAt?: unknown }).expiresAt === 'number') {
      return value as { url: string; expiresAt: number };
    }
  } catch { /* storage unavailable */ }
  return null;
}
function writeCached(workspaceId: string, epoch: number, value: { url: string; expiresAt: number } | null): void {
  try {
    if (value) sessionStorage.setItem(cacheKey(workspaceId, epoch), JSON.stringify(value));
    else sessionStorage.removeItem(cacheKey(workspaceId, epoch));
  } catch { /* storage unavailable */ }
}

export function inviteLinkUrl(link: string): string {
  const url = new URL(routePath({ name: 'join' }), window.location.origin);
  url.hash = new URLSearchParams({ invite: `${INVITE_LINK_PREFIX}${link}` }).toString();
  return url.toString();
}

/** F003-T3: owner-only reusable link for a data table: off by default, expires, can be replaced or turned off. */
export function InviteLinkPanel({ workspaceId, epoch, disabled, onNotice }: { workspaceId: string; epoch: number; disabled: boolean; onNotice: (text: string, tone: 'success' | 'error' | 'info') => void }) {
  const [status, setStatus] = useState<InviteLinkStatus | null>(null);
  const [days, setDays] = useState<Days>(7);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cached, setCached] = useState(() => readCached(workspaceId, epoch));

  useEffect(() => {
    let alive = true;
    tabletopClient.inviteLinkStatus(workspaceId)
      .then((next) => { if (alive) setStatus(next); })
      .catch(() => { if (alive) setStatus({ enabled: false, expiresAt: null }); });
    return () => { alive = false; };
  }, [workspaceId, epoch]);

  const create = useCallback(async () => {
    setBusy(true); setCopied(false);
    try {
      const next = await tabletopClient.createInviteLink(workspaceId, days);
      const value = next.link && next.expiresAt ? { url: inviteLinkUrl(next.link), expiresAt: next.expiresAt } : null;
      writeCached(workspaceId, epoch, value); setCached(value);
      setStatus({ enabled: next.enabled, expiresAt: next.expiresAt });
      onNotice(status?.enabled ? 'A new invite link is ready. The previous link no longer works.' : 'The invite link is on. Anyone signed in with the link can join until it expires or you turn it off.', 'success');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'The invite link could not be created.', 'error'); }
    finally { setBusy(false); }
  }, [workspaceId, epoch, days, onNotice, status?.enabled]);

  const turnOff = useCallback(async () => {
    setBusy(true); setCopied(false);
    try {
      await tabletopClient.disableInviteLink(workspaceId);
      writeCached(workspaceId, epoch, null); setCached(null);
      setStatus({ enabled: false, expiresAt: null });
      onNotice('The invite link is off. Nobody else can join with it.', 'success');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'The invite link could not be turned off.', 'error'); }
    finally { setBusy(false); }
  }, [workspaceId, epoch, onNotice]);

  const copy = useCallback(async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { onNotice('Copy failed. Select the link and copy it manually.', 'error'); }
  }, [onNotice]);

  const shown = status?.enabled && cached && cached.expiresAt === status.expiresAt ? cached.url : null;
  const lock = disabled || busy || status === null;
  return <section className="tt-invite-link" aria-labelledby="tt-invite-link-title">
    <span className="tt-kicker" id="tt-invite-link-title"><Link2 size={13} aria-hidden="true" /> INVITE LINK</span>
    {status === null ? <p role="status"><LoaderCircle size={14} className="tt-spin" /> Checking the link…</p>
      : status.enabled ? <>
        <p>Anyone signed in with this link can join and gets the next free seat. Expires {new Date(status.expiresAt ?? 0).toLocaleString()}.</p>
        {shown ? <div className="tt-invite-link__row">
          <input readOnly value={shown} aria-label="Invite link" onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="tt-button tt-button--quiet" disabled={lock} onClick={() => void copy(shown)}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy link'}</button>
        </div> : <p className="tt-invite-link__note">The link is shown only when it is created. Create a new link to copy it again; the current link then stops working.</p>}
        <div className="tt-invite-link__row">
          <button type="button" className="tt-button tt-button--quiet" disabled={lock} onClick={() => void create()}><RefreshCw size={14} />New link</button>
          <button type="button" className="tt-button tt-button--quiet" disabled={lock} onClick={() => void turnOff()}>Turn off link</button>
        </div>
      </> : <>
        <p>Share one link in a group chat. Everyone who opens it and signs in can join, up to seven members.</p>
        <div className="tt-invite-link__row">
          <label htmlFor="tt-invite-link-days">Expires after</label>
          <select id="tt-invite-link-days" value={days} disabled={lock} onChange={(event) => setDays(Number(event.target.value) as Days)}>
            {DAY_CHOICES.map((choice) => <option key={choice} value={choice}>{choice === 1 ? '1 day' : `${choice} days`}</option>)}
          </select>
          <button type="button" className="tt-button tt-button--primary" disabled={lock} onClick={() => void create()}>Turn on invite link</button>
        </div>
      </>}
  </section>;
}
