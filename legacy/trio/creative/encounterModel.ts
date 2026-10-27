import type { EncounterRule } from '../types';
export type { EncounterRule } from '../types';

export const BASELINE_ENCOUNTER_RULE: EncounterRule = Object.freeze({
  allyShield: false,
  shieldReduction: 2,
});

export const TAUGHT_ENCOUNTER_RULE: EncounterRule = Object.freeze({
  allyShield: true,
  shieldReduction: 2,
});

export const ENCOUNTER_TRACE = Object.freeze([14, 12, 16] as const);
export const ENCOUNTER_ACTORS = ['mira', 'goblin', 'pip'] as const;

export type EncounterActorId = typeof ENCOUNTER_ACTORS[number];
export type EncounterAction = 'shield' | 'attack';
export type EncounterShieldTarget = 'mira' | 'pip';

export interface EncounterHp {
  mira: number;
  pip: number;
  goblin: number;
}

export interface EncounterEvent {
  actorId: EncounterActorId;
  targetId: Exclude<EncounterActorId, 'goblin'> | 'goblin';
  action: EncounterAction;
  roll: number;
  hit: boolean;
  damage: number;
  reducedBy: number;
  label: string;
}

export interface EncounterState {
  hp: EncounterHp;
  wardedAlly: boolean;
  wardedMira: boolean;
  events: EncounterEvent[];
  acted: EncounterActorId[];
}

export interface EncounterOutcome extends EncounterState {
  rule: EncounterRule;
  rolls: number[];
  roundEnded: boolean;
  goblinDefeated: boolean;
}

const INITIAL_HP: EncounterHp = Object.freeze({ mira: 10, pip: 10, goblin: 6 });
const DAMAGE = Object.freeze({ goblin: 4, pip: 6 });
const HIT_TARGET = 10;

export function normalizeEncounterRule(rule: EncounterRule): EncounterRule {
  const reduction = Number.isFinite(rule.shieldReduction)
    ? Math.max(0, Math.min(6, Math.round(rule.shieldReduction)))
    : 0;
  return { allyShield: Boolean(rule.allyShield), shieldReduction: reduction };
}

export function createEncounterState(hp: Partial<EncounterHp> = {}): EncounterState {
  return {
    hp: {
      mira: Math.max(0, hp.mira ?? INITIAL_HP.mira),
      pip: Math.max(0, hp.pip ?? INITIAL_HP.pip),
      goblin: Math.max(0, hp.goblin ?? INITIAL_HP.goblin),
    },
    wardedAlly: false,
    wardedMira: false,
    events: [],
    acted: [],
  };
}

function isAlive(state: EncounterState, actorId: EncounterActorId): boolean {
  return state.hp[actorId] > 0;
}

function eventFor(
  actorId: EncounterActorId,
  targetId: EncounterEvent['targetId'],
  action: EncounterAction,
  roll: number,
  hit: boolean,
  damage: number,
  reducedBy: number,
  label: string,
): EncounterEvent {
  return { actorId, targetId, action, roll, hit, damage, reducedBy, label };
}

/**
 * Applies one actor's action. Actors that are defeated or have already acted
 * return the same state unchanged, making the transition safe for manual play.
 */
export function resolveEncounterAction(
  state: EncounterState,
  actorId: EncounterActorId,
  roll: number,
  rule: EncounterRule,
  shieldTarget?: EncounterShieldTarget,
): EncounterState {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
    throw new RangeError('Encounter rolls must be integers from 1 to 20.');
  }
  if (!isAlive(state, actorId) || state.acted.includes(actorId) || state.hp.goblin <= 0) return state;

  const activeRule = normalizeEncounterRule(rule);
  const hit = roll >= HIT_TARGET;
  let event: EncounterEvent;
  let hp = state.hp;
  let wardedAlly = state.wardedAlly;
  let wardedMira = state.wardedMira;

  if (actorId === 'mira') {
    // The rule unlocks the option to protect Pip; old callers retain the
    // original defaults (self under the baseline rule, Pip under the taught rule).
    const targetId = activeRule.allyShield
      ? shieldTarget ?? 'pip'
      : 'mira';
    wardedAlly = targetId === 'pip' && hit;
    wardedMira = targetId === 'mira' && hit;
    event = eventFor(
      'mira', targetId, 'shield', roll, hit, 0, 0,
      hit
        ? targetId === 'pip' ? 'Mira ตั้งโล่คุ้มกัน Pip' : 'Mira ตั้งโล่ป้องกันตัวเอง'
        : 'Mira ตั้งโล่ไม่ทัน',
    );
  } else if (actorId === 'goblin') {
    const targetId = state.hp.pip > 0 ? 'pip' : 'mira';
    const rawDamage = hit ? DAMAGE.goblin : 0;
    const protectedByShield = targetId === 'pip' ? wardedAlly : wardedMira;
    const reducedBy = protectedByShield
      ? Math.min(rawDamage, activeRule.shieldReduction)
      : 0;
    const damage = Math.min(hp[targetId], Math.max(0, rawDamage - reducedBy));
    hp = { ...hp, [targetId]: Math.max(0, hp[targetId] - damage) };
    event = eventFor(
      'goblin', targetId, 'attack', roll, hit, damage, reducedBy,
      hit
        ? reducedBy > 0 ? `Goblin โจมตี Pip · โล่ลด ${reducedBy}` : `Goblin โจมตี ${targetId === 'pip' ? 'Pip' : 'Mira'}`
        : `Goblin พลาด ${targetId === 'pip' ? 'Pip' : 'Mira'}`,
    );
  } else {
    const damage = hit ? Math.min(DAMAGE.pip, hp.goblin) : 0;
    hp = { ...hp, goblin: Math.max(0, hp.goblin - damage) };
    event = eventFor(
      'pip', 'goblin', 'attack', roll, hit, damage, 0,
      hit ? `Pip ยิงโดน Goblin · ${damage} HP` : 'Pip ยิงพลาด',
    );
  }

  return {
    hp,
    wardedAlly,
    wardedMira,
    events: [...state.events, event],
    acted: [...state.acted, actorId],
  };
}

/** Runs Mira → Goblin → Pip once using the supplied d20 trace. */
export function runEncounter(
  rule: EncounterRule,
  rolls: number[] = [...ENCOUNTER_TRACE],
  shieldTarget?: EncounterShieldTarget,
): EncounterOutcome {
  const normalizedRule = normalizeEncounterRule(rule);
  const trace = ENCOUNTER_ACTORS.map((_, index) => rolls[index] ?? ENCOUNTER_TRACE[index]);
  let state = createEncounterState();
  ENCOUNTER_ACTORS.forEach((actorId, index) => {
    if (state.hp.goblin > 0) {
      state = resolveEncounterAction(state, actorId, trace[index], normalizedRule, shieldTarget);
    }
  });
  return {
    ...state,
    rule: normalizedRule,
    rolls: trace,
    roundEnded: state.hp.goblin <= 0 || ENCOUNTER_ACTORS.every((actorId) => !isAlive(state, actorId) || state.acted.includes(actorId)),
    goblinDefeated: state.hp.goblin <= 0,
  };
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Returns a self-contained offline HTML copy of this tiny encounter. */
export function exportEncounterHtml(rule: EncounterRule): string {
  const normalizedRule = normalizeEncounterRule(rule);
  const embeddedRule = safeScriptJson(normalizedRule);
  const embeddedTrace = safeScriptJson([...ENCOUNTER_TRACE]);

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>การเผชิญหน้า · Mira และ Pip</title>
<style>
:root{font-family:system-ui,'Noto Sans Thai',sans-serif;color:#26364a;background:#f4f5fc}*{box-sizing:border-box}body{margin:0;padding:20px}.card{max-width:700px;margin:auto;padding:18px;background:#fff;border:1px solid #dedff2;border-radius:16px;box-shadow:0 12px 32px #34396612}h1{margin:0;font-size:22px}.sub{margin:4px 0 15px;color:#626c7d;font-size:13px}.board{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.actor{padding:12px;background:#f7f6ff;border-radius:12px}.actor b{display:block}.hp{font:700 12px ui-monospace,monospace;color:#6651ba}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}button{min-height:38px;padding:7px 12px;border:0;border-radius:9px;background:#6550c7;color:white;font:inherit;font-weight:700;cursor:pointer}button.secondary{background:#edf0f8;color:#34445b}.trace,.result{margin-top:10px;padding:11px;background:#f5f7fb;border-radius:10px;font-size:13px}.result strong{color:#5d48b2}.bot{font-size:11px;color:#647184}.log{display:grid;gap:5px;padding-left:18px;font-size:12px}@media(max-width:460px){body{padding:10px}.card{padding:12px}.board{gap:5px}.actor{padding:8px 5px;font-size:12px}}
.shield-choice{display:flex;flex-wrap:wrap;align-items:center;gap:7px 12px;margin:12px 0;padding:10px;border:1px solid #e5e1f1;border-radius:10px;font-size:13px}.shield-choice legend{font-weight:700}.shield-choice label{display:inline-flex;align-items:center;gap:5px}.shield-choice small{flex-basis:100%;color:#647184}.shield-choice input{accent-color:#6550c7}.shield-choice input:focus-visible{outline:2px solid #6550c7;outline-offset:2px}
</style></head>
<body><main class="card"><h1>ทางผ่านของ Goblin</h1><p class="sub">Mira กับ Pip กำลังเริ่มเล่นด้วยกัน เลือกเป้าหมายโล่ แล้วช่วยกันผ่านรอบนี้ · กติกาที่สอน: ${normalizedRule.allyShield ? 'โล่ช่วยเพื่อน' : 'โล่คุ้มกันตัวเอง'}</p>
<section class="board" aria-label="สถานะพลังชีวิต"><div class="actor"><b>Mira · ผู้พิทักษ์</b><span id="mira" class="hp"></span></div><div class="actor"><b>Pip · นักธนู</b><span id="pip" class="hp"></span></div><div class="actor"><b>Goblin</b><span id="goblin" class="hp"></span></div></section>
<fieldset class="shield-choice"><legend>เป้าหมายของโล่ Mira</legend><label><input type="radio" name="shield-target" value="mira" ${normalizedRule.allyShield ? '' : 'checked'}> ป้องกันตัวเอง</label><label><input type="radio" name="shield-target" value="pip" ${normalizedRule.allyShield ? 'checked' : 'disabled'}> ช่วย Pip</label><small id="shield-help">${normalizedRule.allyShield ? 'เลือกได้ก่อน Mira เริ่มแอ็กชัน' : 'เรียนรู้กติกาโล่ช่วยเพื่อนก่อน จึงจะเลือก Pip ได้'}</small></fieldset>
<div class="bot" aria-live="polite">Nina · ผู้ร่วมเล่นจำลอง · พร้อมช่วยดูเกม</div><div class="actions"><button id="play">เล่น 1 รอบ · d20 [14, 12, 16]</button><button id="step" class="secondary">ทีละแอ็กชัน</button><button id="reset" class="secondary">เริ่มใหม่</button></div>
<div id="result" class="result" aria-live="polite">เลือกเล่นรอบหรือดูทีละแอ็กชัน</div><ol id="log" class="log"></ol></main>
<script>
const rule=${embeddedRule}, trace=${embeddedTrace}, order=['mira','goblin','pip'];
const actorLabels={mira:'คุณ · Mira',goblin:'Goblin',pip:'Nina · บอท Pip'};
let shieldTarget=rule.allyShield?'pip':'mira';
let state;
function fresh(){return {hp:{mira:10,pip:10,goblin:6},wardedAlly:false,wardedMira:false,acted:[],events:[],next:0,activeEvent:null}}
function alive(id){return state.hp[id]>0}
function action(actor,roll){
 if(!alive(actor)||state.acted.includes(actor)||state.hp.goblin<=0)return;
 const hit=roll>=10;let text='',target=actor,damage=0,reduced=0;
 if(actor==='mira'){target=rule.allyShield?shieldTarget:'mira';state.wardedAlly=target==='pip'&&hit;state.wardedMira=target==='mira'&&hit;text=hit?(target==='pip'?'Mira ตั้งโล่คุ้มกัน Pip':'Mira ตั้งโล่ป้องกันตัวเอง'):'Mira ตั้งโล่ไม่ทัน'}
 else if(actor==='goblin'){target=alive('pip')?'pip':'mira';const targetName=target==='pip'?'Pip':'Mira';const raw=hit?4:0;const guarded=target==='pip'?state.wardedAlly:state.wardedMira;reduced=guarded?Math.min(raw,rule.shieldReduction):0;damage=Math.min(state.hp[target],Math.max(0,raw-reduced));state.hp[target]=Math.max(0,state.hp[target]-damage);text=hit?(reduced?'Goblin โจมตี '+targetName+' · โล่ลด '+reduced:'Goblin โจมตี '+targetName):'Goblin พลาด '+targetName}
 else{target='goblin';damage=hit?Math.min(6,state.hp.goblin):0;state.hp.goblin=Math.max(0,state.hp.goblin-damage);text=hit?'Pip ยิงโดน Goblin · '+damage+' HP':'Pip ยิงพลาด'}
 state.acted.push(actor);state.activeEvent={actor,target,roll,hit,damage,reduced,text};state.events.push(state.activeEvent);render();
}
function render(){for(const id of order)document.getElementById(id).textContent=state.hp[id]+' / '+({mira:10,pip:10,goblin:6}[id])+' HP';document.getElementById('log').innerHTML=state.events.map(e=>'<li><b>'+actorLabels[e.actor]+' · d20 '+e.roll+'</b> · '+e.text+'</li>').join('');const event=state.activeEvent;const ended=state.hp.goblin===0||state.next>=order.length;const eventText=event?'<strong>'+actorLabels[event.actor]+'</strong> · '+event.text+' · d20 '+event.roll:'';document.getElementById('result').innerHTML=ended?(state.hp.goblin===0?'<strong>ทีมชนะ</strong> · Goblin HP เหลือ 0':'<strong>จบรอบ</strong> · Pip '+state.hp.pip+' HP')+(event?' <span>· '+eventText+'</span>':''):eventText||'ถึงตา '+actorLabels[order[state.next]]+' · '+(order[state.next]==='mira'?'ตั้งโล่':order[state.next]==='goblin'?'โจมตี':'ยิง Goblin');document.querySelector('.bot').textContent=ended?'Nina · ผู้ร่วมเล่นจำลอง · จบรอบเดียวกันแล้ว':event?'Nina · ผู้ร่วมเล่นจำลอง · กำลังดู '+actorLabels[event.actor]:'Nina · ผู้ร่วมเล่นจำลอง · กำลังดู '+actorLabels[order[state.next]||'pip'];document.querySelectorAll('input[name="shield-target"]').forEach(input=>{input.disabled=(input.value==='pip'&&!rule.allyShield)||state.acted.includes('mira')})}
function step(){while(state.next<order.length){const actor=order[state.next],roll=trace[state.next];state.next++;if(alive(actor)&&!state.acted.includes(actor)&&state.hp.goblin>0){action(actor,roll);return}}render()}
function play(){if(state.next>=order.length)reset();while(state.next<order.length)step()}
function reset(){state=fresh();render()}
document.querySelectorAll('input[name="shield-target"]').forEach((input)=>input.addEventListener('change',()=>{if(input.checked&&rule.allyShield&&state.next===0)shieldTarget=input.value}));
document.getElementById('play').addEventListener('click',play);document.getElementById('step').addEventListener('click',step);document.getElementById('reset').addEventListener('click',reset);reset();
</script></body></html>`;
}
