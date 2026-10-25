import { questStatus } from '../domain';
import type { QuestRule } from '../types';

export type QuestStationId = 'garden' | 'library' | 'treasure';

export interface QuestChoice {
  id: string;
  label: string;
}

export interface QuestStation {
  id: QuestStationId;
  label: string;
  title: string;
  clue: string;
  answerId: string;
  choices: QuestChoice[];
  hints: [string, string];
}

export const QUEST_STATIONS: QuestStation[] = [
  {
    id: 'garden',
    label: 'สวน',
    title: 'ดอกไม้ที่หันหาแสง',
    clue: 'สิ่งใดช่วยให้ดอกไม้เติบโตและหันหน้าไปหาแสง?',
    answerId: 'sunlight',
    choices: [
      { id: 'moonlight', label: 'แสงจันทร์' },
      { id: 'sunlight', label: 'แสงแดด' },
      { id: 'stones', label: 'ก้อนหิน' },
    ],
    hints: ['ลองมองขึ้นไปบนท้องฟ้าในตอนเช้า', 'ดอกไม้ต้องการแสงอุ่นจากดวงอาทิตย์'],
  },
  {
    id: 'library',
    label: 'ห้องสมุด',
    title: 'เงื่อนงำบนชั้นหนังสือ',
    clue: 'สิ่งใดมีปกและหน้ากระดาษ แต่ไม่ใช่ต้นไม้?',
    answerId: 'book',
    choices: [
      { id: 'lamp', label: 'โคมไฟ' },
      { id: 'clock', label: 'นาฬิกา' },
      { id: 'book', label: 'หนังสือ' },
    ],
    hints: ['มันมีสันเรียงอยู่บนชั้น', 'ลองนึกถึงสิ่งที่เราเปิดอ่านทีละหน้า'],
  },
  {
    id: 'treasure',
    label: 'กล่องสมบัติ',
    title: 'กุญแจดอกสุดท้าย',
    clue: 'ของชิ้นใดเปิดหีบที่มีรูกุญแจ?',
    answerId: 'key',
    choices: [
      { id: 'ribbon', label: 'ริบบิ้น' },
      { id: 'key', label: 'กุญแจ' },
      { id: 'feather', label: 'ขนนก' },
    ],
    hints: ['ชิ้นเล็ก ๆ นี้มักทำจากโลหะ', 'มองหารูปทรงที่มีฟันให้เข้ากับแม่กุญแจ'],
  },
];

export type QuestGameState = {
  activeStationId: QuestStationId;
  solvedStationIds: QuestStationId[];
  requestedHintLevels: Partial<Record<QuestStationId, 0 | 1 | 2>>;
  requestedAnswerFor: QuestStationId[];
};

export function getActiveQuestHint(
  state: QuestGameState,
  stationId: QuestStationId = state.activeStationId,
): { level: 1 | 2; hint: string } | undefined {
  if (state.solvedStationIds.includes(stationId)) return undefined;
  const level = state.requestedHintLevels[stationId] ?? 0;
  if (level === 0) return undefined;
  const station = QUEST_STATIONS.find((item) => item.id === stationId);
  if (!station) return undefined;
  return { level, hint: station.hints[level - 1] };
}

export function createQuestGameState(): QuestGameState {
  return {
    activeStationId: 'garden',
    solvedStationIds: [],
    requestedHintLevels: {},
    requestedAnswerFor: [],
  };
}

export function isQuestStationUnlocked(state: QuestGameState, stationId: QuestStationId): boolean {
  const stationIndex = QUEST_STATIONS.findIndex((station) => station.id === stationId);
  if (stationIndex < 0) return false;
  if (stationIndex === 0) return true;
  return state.solvedStationIds.includes(QUEST_STATIONS[stationIndex - 1].id);
}

export function selectQuestStation(state: QuestGameState, stationId: QuestStationId): QuestGameState {
  if (!isQuestStationUnlocked(state, stationId)) return state;
  return { ...state, activeStationId: stationId };
}

export type QuestAnswerResult = {
  state: QuestGameState;
  result: 'correct' | 'wrong' | 'locked' | 'already-solved';
  message: string;
  unlockedStationId?: QuestStationId;
};

export function answerQuestStation(
  state: QuestGameState,
  stationId: QuestStationId,
  choiceId: string,
): QuestAnswerResult {
  const station = QUEST_STATIONS.find((item) => item.id === stationId);
  if (!station || !isQuestStationUnlocked(state, stationId)) {
    return { state, result: 'locked', message: 'ด่านนี้ยังล็อกอยู่ ลองไขปริศนาก่อนหน้าให้สำเร็จ' };
  }
  if (state.solvedStationIds.includes(stationId)) {
    return { state, result: 'already-solved', message: 'ด่านนี้ผ่านแล้ว เลือกด่านถัดไปบนแผนที่ได้เลย' };
  }
  if (choiceId !== station.answerId) {
    return { state, result: 'wrong', message: 'คำตอบยังไม่ตรง ลองอีกครั้งหรือขอคำใบ้เมื่อพร้อม' };
  }

  const solvedStationIds = [...state.solvedStationIds, stationId];
  const nextStation = QUEST_STATIONS.find((item) => !solvedStationIds.includes(item.id));
  return {
    state: {
      ...state,
      solvedStationIds,
      activeStationId: nextStation?.id ?? stationId,
    },
    result: 'correct',
    message: nextStation ? `ถูกต้อง · ปลดล็อกด่าน${nextStation.label}แล้ว` : 'ถูกต้อง · ครบทั้งสามด่านแล้ว',
    unlockedStationId: nextStation?.id,
  };
}

export type QuestHintResult = {
  state: QuestGameState;
  result: 'shown' | 'waiting' | 'solved';
  hint?: string;
  message: string;
};

export function requestQuestHint(
  state: QuestGameState,
  rule: QuestRule,
  elapsedSeconds: number,
): QuestHintResult {
  if (state.solvedStationIds.includes(state.activeStationId)) {
    return { state, result: 'solved', message: 'ด่านนี้ผ่านแล้ว จึงไม่มีคำใบ้เพิ่มเติม' };
  }
  const status = questStatus(rule, elapsedSeconds);
  const requestedLevel = state.requestedHintLevels[state.activeStationId] ?? 0;
  const nextLevel = (requestedLevel + 1) as 1 | 2;
  if (status.hintLevel < nextLevel) {
    const threshold = nextLevel === 1 ? rule.firstHint : rule.secondHint;
    return {
      state,
      result: 'waiting',
      message: `คำใบ้${nextLevel === 1 ? 'แรก' : 'ที่สอง'}จะพร้อมเมื่อครบ ${formatQuestTime(threshold)}`,
    };
  }

  const station = QUEST_STATIONS.find((item) => item.id === state.activeStationId)!;
  const nextState: QuestGameState = {
    ...state,
    requestedHintLevels: { ...state.requestedHintLevels, [station.id]: nextLevel },
  };
  return {
    state: nextState,
    result: 'shown',
    hint: station.hints[nextLevel - 1],
    message: `แสดงคำใบ้${nextLevel === 1 ? 'แรก' : 'ที่สอง'}ของด่าน${station.label}`,
  };
}

export type QuestAnswerRevealResult = {
  state: QuestGameState;
  revealed: boolean;
  automatic: boolean;
  message: string;
};

export function requestQuestAnswer(
  state: QuestGameState,
  rule: QuestRule,
  elapsedSeconds: number,
): QuestAnswerRevealResult {
  const status = questStatus(rule, elapsedSeconds, state.solvedStationIds.includes(state.activeStationId));
  if (status.answerRevealed) {
    return { state, revealed: true, automatic: true, message: 'เฉลยเปิดตามกติกาเวลา' };
  }
  if (rule.autoReveal || status.hintLevel < 2) {
    return { state, revealed: false, automatic: false, message: `ขอเฉลยได้เมื่อครบ ${formatQuestTime(rule.secondHint)}` };
  }
  return {
    state: state.requestedAnswerFor.includes(state.activeStationId)
      ? state
      : { ...state, requestedAnswerFor: [...state.requestedAnswerFor, state.activeStationId] },
    revealed: true,
    automatic: false,
    message: 'เปิดเฉลยตามที่ผู้เล่นเลือก',
  };
}

export function isQuestAnswerRevealed(
  state: QuestGameState,
  rule: QuestRule,
  elapsedSeconds: number,
): boolean {
  if (state.solvedStationIds.includes(state.activeStationId)) return false;
  const status = questStatus(rule, elapsedSeconds, state.solvedStationIds.includes(state.activeStationId));
  return status.answerRevealed || state.requestedAnswerFor.includes(state.activeStationId);
}

export function formatQuestTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

/** Build an offline, dependency-free HTML game with the same hint/reveal thresholds as the app. */
export function exportPlayableQuestHtml(rule: QuestRule): string {
  const firstHint = escapeHtml(String(rule.firstHint));
  const secondHint = escapeHtml(String(rule.secondHint));
  const autoReveal = escapeHtml(String(rule.autoReveal));
  const stationMarkup = QUEST_STATIONS.map((station, index) => `
      <button class="station" type="button" data-station="${station.id}" ${index > 0 ? 'disabled' : ''}>
        <span>${index + 1}</span>${escapeHtml(station.label)}
      </button>`).join('');
  const choiceMarkup = QUEST_STATIONS.map((station) => `
      <section class="puzzle" data-puzzle="${station.id}" ${station.id !== 'garden' ? 'hidden' : ''}>
        <h2>${escapeHtml(station.title)}</h2><p>${escapeHtml(station.clue)}</p>
        <div class="choices">${station.choices.map((choice) => `<button type="button" data-choice="${choice.id}">${escapeHtml(choice.label)}</button>`).join('')}</div>
        <p class="feedback" data-feedback aria-live="polite"></p>
      </section>`).join('');
  const exportedStations = QUEST_STATIONS.map((station) => ({
    id: station.id,
    answerId: station.answerId,
    answerLabel: station.choices.find((choice) => choice.id === station.answerId)?.label ?? '',
    hints: station.hints,
  }));

  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>เกมล่าขุมทรัพย์</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#eef0e7;color:#24372f;font:16px/1.55 system-ui,'Noto Sans Thai',sans-serif}.game{max-width:850px;margin:auto;padding:24px;background:#fffdf5;border:1px solid #d7ddc8;border-radius:18px;box-shadow:0 12px 35px #24372f12}h1{margin:0;color:#29483b}p{margin:8px 0}.map,.choices,.tools{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.station,.choices button,.tools button{border:1px solid #cad5c2;border-radius:12px;padding:10px 14px;background:#fff;color:inherit;cursor:pointer}.station[aria-current=true]{background:#e9f0de;border-color:#789c69}.station:disabled{opacity:.48;cursor:not-allowed}.choices button:hover,.tools button:hover{border-color:#638a56}.feedback{min-height:28px;color:#9b5142}.hints,.answer{padding:12px 14px;border-radius:12px;background:#eff2e6}button:focus-visible{outline:3px solid #b96a4e;outline-offset:2px}[hidden]{display:none!important}
  </style></head><body><main class="game" data-quest-app data-first-hint="${firstHint}" data-second-hint="${secondHint}" data-auto-reveal="${autoReveal}">
<h1>แผนที่ตามหาขุมทรัพย์</h1><p>ผ่านปริศนาทีละด่านเพื่อปลดล็อกเส้นทาง</p><p>เวลาที่ผ่านไป <strong data-clock>0:00</strong> · กติกาคำใบ้ <span data-rule></span></p>
<div class="map" aria-label="เลือกด่าน">${stationMarkup}</div>${choiceMarkup}
<div class="tools"><button type="button" data-start>เริ่มเวลา</button><button type="button" data-hint>ขอคำใบ้</button><button type="button" data-answer>ขอเฉลย</button></div>
<p class="hints" data-hint-output aria-live="polite">คำใบ้จะปรากฏเมื่อถึงเวลาที่กำหนด</p><p class="answer" data-answer-output hidden aria-live="polite"></p><p data-result aria-live="polite"></p>
</main><script>
(()=>{
  const root=document.querySelector('[data-quest-app]');
  if(!root)return;
  const first=Number(root.dataset.firstHint),second=Number(root.dataset.secondHint),automatic=root.dataset.autoReveal==='true';
  let elapsed=0,running=false,active='garden';
  const solved=new Set(),hints=new Map(),requestedAnswers=new Set();
  const stations=${JSON.stringify(exportedStations).replace(/</g,'\\u003c')};
  const clock=root.querySelector('[data-clock]'),ruleText=root.querySelector('[data-rule]'),hintOutput=root.querySelector('[data-hint-output]'),answerOutput=root.querySelector('[data-answer-output]'),result=root.querySelector('[data-result]');
  const time=n=>Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0');
  const status=()=>solved.has(active)?{level:0,reveal:false}:{level:elapsed>=second?2:elapsed>=first?1:0,reveal:automatic&&elapsed>=second};
  function render(){
    const activeStation=stations.find(s=>s.id===active);
    clock.textContent=time(elapsed);
    ruleText.textContent=time(first)+' / '+time(second)+(automatic?' · เฉลยตามเวลา':' · ขอเฉลยเอง');
    root.querySelectorAll('[data-station]').forEach(button=>{const i=stations.findIndex(s=>s.id===button.dataset.station);button.disabled=i>0&&!solved.has(stations[i-1].id);button.setAttribute('aria-current',String(button.dataset.station===active));});
    root.querySelectorAll('[data-puzzle]').forEach(puzzle=>{puzzle.hidden=puzzle.dataset.puzzle!==active;});
    const state=status(),revealed=!solved.has(active)&&(state.reveal||requestedAnswers.has(active));
    answerOutput.hidden=!revealed;
    answerOutput.textContent=revealed?'เฉลย: '+stations.find(s=>s.id===active).answerLabel:'';
    const hintLevel=solved.has(active)?0:(hints.get(active)||0);
    hintOutput.textContent=hintLevel?'คำใบ้'+(hintLevel===1?'แรก':'ที่สอง')+': '+activeStation.hints[hintLevel-1]:solved.has(active)?'ด่านนี้ผ่านแล้ว':'คำใบ้จะปรากฏเมื่อถึงเวลาที่กำหนด';
    root.querySelector('[data-hint]').disabled=solved.has(active)||state.level<((hints.get(active)||0)+1);
    root.querySelector('[data-answer]').disabled=automatic||state.level<2||solved.has(active);
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if(!button)return;
    if(button.dataset.station){active=button.dataset.station;render();return;}
    if(button.dataset.choice){
      const puzzle=button.closest('[data-puzzle]'),station=stations.find(s=>s.id===active);
      if(solved.has(active)){puzzle.querySelector('[data-feedback]').textContent='ด่านนี้ผ่านแล้ว เลือกด่านถัดไปบนแผนที่ได้เลย';render();return;}
      if(button.dataset.choice!==station.answerId){puzzle.querySelector('[data-feedback]').textContent='คำตอบยังไม่ตรง ลองอีกครั้งหรือขอคำใบ้เมื่อพร้อม';}
      else{
        solved.add(active);
        const next=stations.find(s=>!solved.has(s.id));
        result.textContent=next?'ถูกต้อง · ปลดล็อกด่านถัดไปแล้ว':'ถูกต้อง · ครบทั้งสามด่านแล้ว';
        if(next)active=next.id;
        else{running=false;const start=root.querySelector('[data-start]');start.textContent='ครบทุกด่านแล้ว';start.disabled=true;}
        puzzle.querySelector('[data-feedback]').textContent=result.textContent;
      }
      render();return;
    }
    if(button.matches('[data-start]')){running=!running;button.textContent=running?'พักเวลา':'เริ่มเวลา';return;}
    if(button.matches('[data-hint]')){
      const level=(hints.get(active)||0)+1,station=stations.find(s=>s.id===active);
      if(!solved.has(active)&&status().level>=level)hints.set(active,level);
      render();return;
    }
    if(button.matches('[data-answer]')){
      if(!solved.has(active)&&!automatic&&status().level>=2)requestedAnswers.add(active);
      render();
    }
  });
  window.setInterval(()=>{if(running){elapsed+=1;render();}},1000);
  render();
})();
</script></body></html>`;
}
