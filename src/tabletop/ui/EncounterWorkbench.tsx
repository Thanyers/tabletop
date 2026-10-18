import { useEffect, useState } from 'react';
import { Activity, Clock3, Heart, RotateCw, Shield, ShieldCheck, Swords, Target } from 'lucide-react';
import type { EncounterRule, EncounterState } from '../shared/contracts';
import type { WorkbenchProps } from './types';
import { CandidateLifecycle } from './WorkbenchShared';

interface EncounterBoard {
  characters: EncounterState['characters'];
  phase: EncounterState['phase'];
  pendingHit: EncounterState['pendingHit'];
  turn: EncounterState['turn'];
  events: EncounterState['events'];
  rule: EncounterState['rule'];
}

function boardFromPlan(plan: WorkbenchProps['plan']): EncounterBoard | null {
  const board = plan.nodes.find((node) => node.id === 'encounter.board')?.inputs.board;
  if (typeof board !== 'object' || board === null) return null;
  const candidate = board as Partial<EncounterBoard>;
  return Array.isArray(candidate.characters) && typeof candidate.phase === 'string' && typeof candidate.turn === 'string'
    ? candidate as EncounterBoard
    : null;
}

export function EncounterWorkbench(props: WorkbenchProps) {
  const { view, plan, onCommand, busy } = props;
  if (view.domain.kind !== 'encounter') return null;
  const state: EncounterState = view.domain;
  const board = boardFromPlan(plan);
  const isDm = view.actor.role === 'dm';
  const actorId = view.actor.seat === 'mira' || view.actor.seat === 'pip' ? view.actor.seat : null;
  const activeCharacter = board?.turn ?? state.turn;
  const ownTurn = !!actorId && actorId === activeCharacter;
  const pending = board?.pendingHit ?? state.pendingHit;
  const phase = board?.phase ?? state.phase;
  const characters = board?.characters ?? state.characters;
  const events = board?.events ?? state.events;
  const activeRule = board?.rule ?? state.rule;
  const [rule, setRule] = useState<EncounterRule>(state.rule);
  const [note, setNote] = useState(state.dmNote ?? '');
  const [tick, setTick] = useState(Date.now());

  useEffect(() => setRule(state.rule), [state.rule]);
  useEffect(() => setNote(state.dmNote ?? ''), [state.dmNote]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [pending?.deadline]);

  const remainingMs = pending ? Math.max(0, pending.deadline - tick) : 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const hitTarget = pending?.target ?? null;
  const canReact = view.actor.role === 'player' && !!actorId && !!pending && phase === 'reaction.open'
    && (hitTarget === actorId || activeRule.allyTarget)
    && !pending.shields.some((intent) => intent.actor === actorId || intent.target === hitTarget);
  const canEndTurn = (isDm || ownTurn) && (phase === 'turn.start' || phase === 'action.resolved') && !pending;

  const proposeRule = () => { void onCommand('evolve.propose', { change: { kind: 'encounter', rule } }); };
  const saveNote = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); void onCommand('encounter.saveNote', { text: note }); };
  const nameFor = (id?: string | null) => characters.find((character) => character.id === id)?.name ?? 'the character';

  return (
    <div className="tt-workbench-body tt-encounter">
      <section className="tt-case-heading"><div><span className="tt-kicker">ENCOUNTER TABLE · {view.actor.role.toUpperCase()}</span><h1>A shared turn with a clear reaction window</h1><p>Original, simplified fantasy rules. The server records the hit and owns turn order.</p></div><span className="tt-revision-mark"><Activity size={15} /> Rules r{state.ruleRevision}</span></section>

      <section className="tt-encounter-board" aria-label="Encounter board with Mira, Pip, and goblin">
        <header className="tt-encounter-board__header"><div><span className="tt-kicker">CONNECTED ENCOUNTER</span><strong>{phase.replaceAll('.', ' · ')}</strong></div><span className="tt-turn-pill"><i aria-hidden="true" /> {nameFor(activeCharacter)}’s turn</span></header>
        <svg className="tt-encounter-map" viewBox="0 0 720 230" role="img" aria-label={`Fantasy encounter map. It is ${nameFor(activeCharacter)}'s turn.`}>
          <defs><pattern id="tt-map-grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#dce4dc" strokeWidth="1" /></pattern></defs>
          <rect x="0" y="0" width="720" height="230" fill="url(#tt-map-grid)" />
          <path d="M33 174 C144 119 181 134 252 170 S383 214 456 159 585 111 682 141" fill="none" stroke="#b8c9b8" strokeWidth="24" strokeLinecap="round" opacity=".48" />
          <path d="M33 174 C144 119 181 134 252 170 S383 214 456 159 585 111 682 141" fill="none" stroke="#8ea997" strokeWidth="2" strokeDasharray="5 8" />
          <path d="M70 37l20 24H50Z M93 42l18 22H75Z M635 32l21 26h-42Z M604 39l17 21h-34Z" fill="#adc1ac" stroke="#819c85" strokeWidth="1" />
          <path d="M336 58l14-16 14 16-8 28h-12Z" fill="#e4cf9f" stroke="#9d8451" strokeWidth="1.5" />
          {characters.map((character) => {
            const position = character.id === 'mira' ? { x: 168, y: 120 } : character.id === 'pip' ? { x: 525, y: 136 } : { x: 360, y: 150 };
            const selected = activeCharacter === character.id;
            const targeted = pending?.target === character.id;
            const fill = character.id === 'goblin' ? '#b36f50' : character.id === 'mira' ? '#315eb0' : '#24796b';
            return <g key={character.id} transform={`translate(${position.x} ${position.y})`} className={selected ? 'tt-token is-active' : 'tt-token'}>
              {(selected || targeted) && <circle cx="0" cy="0" r="43" fill={targeted ? '#c58c3d' : '#24796b'} opacity=".12" />}
              <circle cx="0" cy="0" r="31" fill="#fff" stroke={selected ? '#24796b' : '#d4ded9'} strokeWidth={selected ? 3 : 1.5} />
              {character.id === 'goblin' ? <><path d="M-17-17l-15-14 23 4m22 10 15-14-23 4" fill="#8c543e" stroke="#704333" strokeWidth="2" /><path d="M-17-4q17-17 34 0v14q-17 17-34 0Z" fill={fill} /><circle cx="-7" cy="1" r="2" fill="#fff5df"/><circle cx="7" cy="1" r="2" fill="#fff5df"/><path d="M-5 11q5 4 10 0" fill="none" stroke="#f3dfbb" strokeWidth="2" /></> : <><circle cx="0" cy="-7" r="10" fill={character.id === 'mira' ? '#d9b49b' : '#d1a87c'} /><path d="M-18 18q2-24 18-24t18 24Z" fill={fill} /><path d="M-15-11q3-19 19-13l10 14" fill="none" stroke={character.id === 'mira' ? '#493b35' : '#634b36'} strokeWidth="5" /></>}
              <text x="0" y="51" textAnchor="middle" className="tt-map-name">{character.name}</text>
              {targeted && <text x="0" y="-47" textAnchor="middle" className="tt-map-target">HIT TARGET</text>}
            </g>;
          })}
        </svg>
        <div className="tt-character-grid">{characters.map((character) => <CharacterCard key={character.id} character={character} active={activeCharacter === character.id} target={pending?.target === character.id} />)}</div>
        <div className="tt-rule-summary"><span>SHIELD RULE r{state.ruleRevision}</span><strong>{activeRule.allyTarget ? 'Self or ally' : 'Self only'} · {activeRule.apCost} AP{activeRule.oncePerTurn ? ' · once per turn' : ''}</strong></div>
      </section>

      <section className="tt-section tt-action-section" aria-labelledby="tt-action-title"><header className="tt-section__header"><div><span className="tt-kicker">SERVER-AUTHORITATIVE ACTIONS</span><h2 id="tt-action-title">Current action</h2></div><span className={`tt-status-pill ${phase === 'reaction.open' ? 'tt-status-pill--pending' : 'tt-status-pill--active'}`}>{phase === 'reaction.open' ? 'Reaction open' : phase.replaceAll('.', ' ')}</span></header>
        {phase === 'reaction.open' && pending ? <div className="tt-reaction-window"><div className="tt-reaction-window__icon"><Shield size={20} /></div><div className="tt-reaction-window__copy"><strong>{nameFor(pending.attacker)} declared a hit against {nameFor(pending.target)}.</strong><p>{pending.damage === null ? 'Damage stays with the DM until resolution.' : `${pending.damage} damage is pending.`} Eligible players may react before the DM resolves it.</p>{pending.shields.length > 0 && <small>{pending.shields.length} shield reaction{pending.shields.length === 1 ? '' : 's'} declared; outcomes are checked when resolved.</small>}</div><div className={`tt-countdown${remainingSeconds <= 5 ? ' is-ending' : ''}`} aria-live="polite"><Clock3 size={15} /><strong>{remainingSeconds}s</strong><span>server deadline</span></div></div> : phase === 'action.resolved' ? <div className="tt-action-summary"><Activity size={16} /><p>The action is resolved. The active character can end the turn when ready.</p></div> : <div className="tt-action-summary"><Activity size={16} /><p>{nameFor(activeCharacter)} is ready. The next action follows the active table rules.</p></div>}
        <div className="tt-action-controls">
          {isDm && phase === 'turn.start' && activeCharacter === 'goblin' && <div className="tt-declare-controls"><span><Target size={14} /> Goblin target</span><button type="button" className="tt-button tt-button--primary" disabled={busy !== null} onClick={() => void onCommand('encounter.declareHit', { target: 'mira' })}>Declare hit · Mira</button><button type="button" className="tt-button tt-button--quiet" disabled={busy !== null} onClick={() => void onCommand('encounter.declareHit', { target: 'pip' })}>Declare hit · Pip</button></div>}
          {view.actor.role === 'player' && actorId && phase === 'reaction.open' && <div className="tt-shield-controls"><span><ShieldCheck size={14} /> Shield reaction</span>{canReact ? <button type="button" className="tt-button tt-button--primary" disabled={busy !== null || remainingMs === 0} onClick={() => void onCommand('encounter.shield', { target: hitTarget })}>{hitTarget === actorId ? `Shield ${nameFor(actorId)}` : `Shield ally · ${nameFor(hitTarget)}`}</button> : <p>{actorId !== hitTarget && !activeRule.allyTarget ? 'The current rule only permits self protection.' : 'Your character has already reacted or this target is covered.'}</p>}</div>}
          {isDm && phase === 'reaction.open' && pending && <button type="button" className="tt-button tt-button--primary" disabled={busy !== null} onClick={() => void onCommand('encounter.resolve', {})}>Resolve hit</button>}
          {(isDm || ownTurn) && <button type="button" className="tt-button tt-button--quiet" disabled={busy !== null || !canEndTurn} onClick={() => void onCommand('encounter.endTurn', {})}><RotateCw size={14} /> End {nameFor(activeCharacter)}’s turn</button>}
          {view.actor.role === 'player' && !ownTurn && phase !== 'reaction.open' && <p className="tt-turn-hint">You can act when your character’s turn begins.</p>}
          {phase === 'reaction.open' && <p className="tt-turn-hint">The reaction deadline is set by the server. The DM can resolve the window at any time.</p>}
        </div>
      </section>

      <section className="tt-section" aria-labelledby="tt-history-title"><header className="tt-section__header"><div><span className="tt-kicker">SHARED HISTORY</span><h2 id="tt-history-title">Recorded encounter events</h2></div><span className="tt-count-mark">{events.length}</span></header>{events.length === 0 ? <p className="tt-section-intro">No events have been recorded.</p> : <ol className="tt-event-list">{events.slice(-8).reverse().map((event) => <li key={event.id}><i aria-hidden="true" /><span>{event.text}</span><small>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></li>)}</ol>}</section>

      {isDm && <section className="tt-section" aria-labelledby="tt-rule-editor-title"><header className="tt-section__header"><div><span className="tt-kicker">BOUNDED RULE EDITOR</span><h2 id="tt-rule-editor-title">Propose shield rules</h2></div><span className="tt-status-pill tt-status-pill--active">Active r{state.ruleRevision}</span></header><div className="tt-encounter-rule-editor"><label className="tt-toggle-row"><span><strong>Allow protecting an ally</strong><small>When off, a character can shield only themself.</small></span><input type="checkbox" checked={rule.allyTarget} onChange={(event) => setRule((current) => ({ ...current, allyTarget: event.target.checked }))} /></label><label className="tt-toggle-row"><span><strong>Shield action-point cost</strong><small>Spend one AP from the reacting character.</small></span><select value={rule.apCost} onChange={(event) => setRule((current) => ({ ...current, apCost: Number(event.target.value) as 0 | 1 }))}><option value={0}>No cost</option><option value={1}>1 AP</option></select></label><label className="tt-toggle-row"><span><strong>Once per character turn</strong><small>A shield can be used once until that character’s next turn.</small></span><input type="checkbox" checked={rule.oncePerTurn} onChange={(event) => setRule((current) => ({ ...current, oncePerTurn: event.target.checked }))} /></label><button type="button" className="tt-button tt-button--primary" disabled={busy !== null || JSON.stringify(rule) === JSON.stringify(state.rule)} onClick={proposeRule}><ShieldCheck size={14} /> Propose rules</button></div><p className="tt-section-intro">Simulation reuses a recorded encounter scenario. A draft affects future eligible actions after activation.</p></section>}

      {isDm && <section className="tt-section" aria-labelledby="tt-dm-note-title"><header className="tt-section__header"><div><span className="tt-kicker">DM ONLY</span><h2 id="tt-dm-note-title">Private table note</h2></div><span className="tt-private-lock">Hidden from players</span></header><form className="tt-note-form" onSubmit={saveNote}><label className="tt-visually-hidden" htmlFor="tt-dm-note">Private DM note</label><textarea id="tt-dm-note" rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Write a note only the DM can see…" /><div><small>{note.length}/2000 characters</small><button className="tt-button tt-button--quiet" type="submit" disabled={busy !== null || note === (state.dmNote ?? '')}><ShieldCheck size={14} /> Save private note</button></div></form></section>}

      {isDm && <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} />}
      <section className="tt-footer-note"><Swords size={14} /><span>Original simplified rules. The server validates current turn, actor seat, target, AP, cooldown, deadline, and rule revision.</span></section>
    </div>
  );
}

function CharacterCard({ character, active, target }: { character: EncounterState['characters'][number]; active: boolean; target: boolean }) {
  return <article className={`tt-character-card${active ? ' is-active' : ''}${target ? ' is-target' : ''}`}><div className="tt-character-card__name"><span>{character.id === 'goblin' ? <Swords size={14} /> : character.id === 'mira' ? 'M' : 'P'}</span><strong>{character.name}</strong>{active && <small>Turn</small>}</div><div className="tt-character-stats"><span><Heart size={13} /> {character.hp}/{character.maxHp} HP</span><span><Activity size={13} /> {character.ap} AP</span></div><div className="tt-hp-meter" role="meter" aria-label={`${character.name} health`} aria-valuemin={0} aria-valuemax={character.maxHp} aria-valuenow={character.hp}><i style={{ width: `${Math.max(0, Math.min(100, (character.hp / character.maxHp) * 100))}%` }} /></div>{target && <span className="tt-target-label">Pending hit target</span>}</article>;
}
