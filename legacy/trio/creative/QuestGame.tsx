import { useEffect, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleHelp,
  Clock3,
  Compass,
  KeyRound,
  Lightbulb,
  LockKeyhole,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Sprout,
  type LucideIcon,
} from 'lucide-react';
import { initialRules, questStatus } from '../domain';
import type { QuestRule } from '../types';
import {
  answerQuestStation,
  createQuestGameState,
  exportPlayableQuestHtml,
  formatQuestTime,
  getActiveQuestHint,
  isQuestAnswerRevealed,
  isQuestStationUnlocked,
  QUEST_STATIONS,
  requestQuestAnswer,
  requestQuestHint,
  selectQuestStation,
  type QuestStationId,
} from './questGameModel';
import './quest-game.css';

export type QuestGameTimer = {
  seconds: number;
  running: boolean;
  solved: boolean;
  setRunning: (running: boolean) => void;
  setSolved: (solved: boolean) => void;
  setSeconds: (seconds: number) => void;
  reset: () => void;
};

export type QuestGameProps = {
  rule: QuestRule;
  guided: boolean;
  paused: boolean;
  demoActive: boolean;
  timer: QuestGameTimer;
  onFeedback: (detail: string) => void;
};

const stationIcons: Record<QuestStationId, LucideIcon> = {
  garden: Sprout,
  library: BookOpen,
  treasure: KeyRound,
};

const stationPositions: Record<QuestStationId, CSSProperties> = {
  garden: { left: '16%', top: '52%' },
  library: { left: '50%', top: '34%' },
  treasure: { left: '83%', top: '53%' },
};

function QuestMap({
  activeStationId,
  solvedStationIds,
  unlocked,
  interactive,
  onSelect,
}: {
  activeStationId: QuestStationId;
  solvedStationIds: QuestStationId[];
  unlocked: (stationId: QuestStationId) => boolean;
  interactive: boolean;
  onSelect: (stationId: QuestStationId) => void;
}) {
  return (
    <div className="quest-game__map" role="group" aria-label="แผนที่สามด่าน">
      <svg className="quest-game__map-art" viewBox="0 0 900 320" role="img" aria-labelledby="quest-map-title quest-map-description">
        <title id="quest-map-title">แผนที่ตามหาขุมทรัพย์</title>
        <desc id="quest-map-description">เส้นทางคดเคี้ยวจากสวน ผ่านห้องสมุด ไปยังกล่องสมบัติ</desc>
        <defs>
          <pattern id="quest-map-grain" width="23" height="23" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="4" r="1" fill="#708867" opacity=".13" />
            <circle cx="17" cy="15" r=".8" fill="#a77d4e" opacity=".11" />
          </pattern>
        </defs>
        <rect width="900" height="320" rx="18" fill="#eff0df" />
        <path d="M0 44 Q140 0 255 42 T505 35 T900 46 V0 H0Z" fill="#d9e2ce" />
        <path d="M0 244 Q145 213 266 251 T531 239 T900 254 V320 H0Z" fill="#dce7d4" />
        <path d="M0 160 C115 130 145 207 260 177 S427 128 500 173 S640 237 745 185 S831 146 900 166" fill="none" stroke="#c7ded8" strokeWidth="38" strokeLinecap="round" opacity=".9" />
        <path d="M0 160 C115 130 145 207 260 177 S427 128 500 173 S640 237 745 185 S831 146 900 166" fill="none" stroke="#f5f3e5" strokeWidth="4" strokeDasharray="2 13" strokeLinecap="round" />
        <path d="M115 171 C190 252 303 246 375 160 S526 67 601 144 S733 241 807 176" fill="none" stroke="#b28350" strokeWidth="3" strokeDasharray="3 9" strokeLinecap="round" opacity=".72" />
        <g fill="#65825f" opacity=".85">
          <path d="M68 83l20-34 20 34h-12l17 25H63l17-25zM112 231l17-28 18 28h-10l14 21h-44l14-21zM811 67l19-31 19 31h-11l14 22h-45l14-22z" />
          <path d="M205 71l14-24 14 24h-8l11 17h-34l11-17zM714 241l15-26 16 26h-9l12 19h-37l12-19z" opacity=".6" />
        </g>
        <g transform="translate(417 92)" fill="#e8d9b9" stroke="#9d7852" strokeWidth="3" strokeLinejoin="round">
          <path d="M0 52h94v64H0z" />
          <path d="M-8 52l13-37h84l13 37z" fill="#bd9163" />
          <path d="M14 64v38m20-38v38m20-38v38m20-38v38" fill="none" stroke="#ad875f" strokeWidth="2" />
          <path d="M35 79h25v37H35z" fill="#738767" />
        </g>
        <g transform="translate(742 85)" fill="#c78a48" stroke="#8b5c37" strokeWidth="3" strokeLinejoin="round">
          <path d="M4 38h86v56H4z" />
          <path d="M0 38l9-27h76l9 27z" fill="#e4b764" />
          <path d="M36 45h22v24H36z" fill="#f6dda0" />
          <path d="M45 50a2 2 0 114 0v7h-4z" fill="#805631" stroke="none" />
        </g>
        <g transform="translate(72 119)" fill="#78946c" stroke="#5c7557" strokeWidth="2">
          <circle cx="35" cy="26" r="23" /><circle cx="66" cy="35" r="17" /><path d="M35 47v39m31-30v30" fill="none" strokeWidth="5" />
          <circle cx="19" cy="14" r="3" fill="#e3b66c" stroke="none" /><circle cx="44" cy="9" r="3" fill="#e3b66c" stroke="none" />
        </g>
        <rect width="900" height="320" rx="18" fill="url(#quest-map-grain)" />
        <path d="M22 22h30M22 22v30M878 22h-30M878 22v30M22 298h30M22 298v-30M878 298h-30M878 298v-30" fill="none" stroke="#a6ad91" strokeWidth="2" opacity=".65" />
      </svg>
      <div className="quest-game__map-nodes">
        {QUEST_STATIONS.map((station, index) => {
          const Icon = stationIcons[station.id];
          const isUnlocked = unlocked(station.id);
          const isSolved = solvedStationIds.includes(station.id);
          const isActive = activeStationId === station.id;
          return (
            <button
              key={station.id}
              type="button"
              className={`quest-game__map-node ${isActive ? 'is-active' : ''} ${isSolved ? 'is-solved' : ''} ${!isUnlocked ? 'is-locked' : ''}`}
              style={stationPositions[station.id]}
              aria-label={`${station.label} · ${isSolved ? 'ผ่านแล้ว' : isUnlocked ? 'เปิดแล้ว' : 'ล็อกอยู่'}`}
              aria-pressed={isActive}
              data-quest-station={station.id}
              disabled={!interactive || !isUnlocked}
              onClick={() => onSelect(station.id)}
            >
              <span className="quest-game__map-node-icon">{isSolved ? <Check size={17} aria-hidden="true" /> : isUnlocked ? <Icon size={17} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}</span>
              <span className="quest-game__map-node-copy"><small>ด่าน {index + 1}</small><strong>{station.label}</strong></span>
            </button>
          );
        })}
      </div>
      <span className="quest-game__map-caption"><Compass size={13} aria-hidden="true" /> เส้นทางจะเปิดทีละด่าน</span>
    </div>
  );
}

export function QuestGame({ rule, guided, paused, demoActive, timer, onFeedback }: QuestGameProps) {
  const [gameState, setGameState] = useState(createQuestGameState);
  const [feedback, setFeedback] = useState('');
  const isPreview = guided && demoActive;
  const activeStationId = isPreview ? 'library' : gameState.activeStationId;
  const station = QUEST_STATIONS.find((item) => item.id === activeStationId)!;
  const allSolved = gameState.solvedStationIds.length === QUEST_STATIONS.length;
  const stationSolved = isPreview ? false : allSolved || gameState.solvedStationIds.includes(activeStationId);
  const interactive = !guided && !paused && !demoActive && !timer.solved;
  const displaySeconds = isPreview ? 220 : timer.seconds;
  const status = questStatus(rule, displaySeconds, stationSolved);
  const requestedHintLevel = isPreview || stationSolved ? 0 : gameState.requestedHintLevels[activeStationId] ?? 0;
  const nextHintLevel = requestedHintLevel + 1;
  const canRequestHint = interactive && !stationSolved && nextHintLevel <= 2 && status.hintLevel >= nextHintLevel;
  const answerRevealed = isPreview
    ? false
    : isQuestAnswerRevealed(gameState, rule, timer.seconds);
  const currentHint = isPreview ? '' : getActiveQuestHint(gameState, activeStationId)?.hint ?? '';
  const previewOldRule = initialRules().quest;
  const previewCurrentStatus = questStatus(rule, 220);
  const answeredCount = isPreview ? 1 : gameState.solvedStationIds.length;
  const activeAnswer = station.choices.find((choice) => choice.id === station.answerId)?.label ?? '';
  const answerButtonLabel = rule.autoReveal ? 'เฉลยจะเปิดตามเวลา' : 'ขอเฉลย';

  useEffect(() => {
    if (paused && timer.running) timer.setRunning(false);
  }, [paused, timer.running, timer.setRunning]);

  const handleAnswer = (choiceId: string) => {
    if (!interactive) return;
    const outcome = answerQuestStation(gameState, activeStationId, choiceId);
    setGameState(outcome.state);
    setFeedback(outcome.message);
    if (outcome.result === 'correct' && outcome.state.solvedStationIds.length === QUEST_STATIONS.length) {
      timer.setRunning(false);
      timer.setSolved(true);
    }
    onFeedback(outcome.message);
  };

  const handleHint = () => {
    if (!interactive) return;
    const outcome = requestQuestHint(gameState, rule, timer.seconds);
    setGameState(outcome.state);
    setFeedback(outcome.message);
    onFeedback(outcome.message);
  };

  const handleAnswerRequest = () => {
    if (!interactive) return;
    const outcome = requestQuestAnswer(gameState, rule, timer.seconds);
    setGameState(outcome.state);
    setFeedback(outcome.message);
    onFeedback(outcome.message);
  };

  const handleStationSelect = (stationId: QuestStationId) => {
    if (!interactive) return;
    if (!isQuestStationUnlocked(gameState, stationId)) {
      setFeedback('ด่านนี้ยังล็อกอยู่ ลองไขปริศนาก่อนหน้าให้สำเร็จ');
      return;
    }
    setGameState((current) => selectQuestStation(current, stationId));
    setFeedback('');
  };

  const handleReset = () => {
    if (guided || paused || demoActive) return;
    timer.reset();
    setGameState(createQuestGameState());
    setFeedback('เริ่มเกมใหม่แล้ว');
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const stationIndex = Number(event.key) - 1;
    if (stationIndex >= 0 && stationIndex < QUEST_STATIONS.length) {
      const targetStation = QUEST_STATIONS[stationIndex];
      if (!isQuestStationUnlocked(gameState, targetStation.id)) return;
      event.preventDefault();
      setGameState((current) => selectQuestStation(current, targetStation.id));
      setFeedback('');
    } else if (event.key.toLowerCase() === 'h' && canRequestHint) {
      event.preventDefault();
      handleHint();
    }
  };

  const timerRunning = timer.running && !paused;
  const unlocked = (stationId: QuestStationId) => isPreview
    ? stationId !== 'treasure'
    : isQuestStationUnlocked(gameState, stationId);

  return (
    <section className="quest-game" aria-label="เกมล่าขุมทรัพย์" data-testid="quest-game" data-guided-preview={isPreview ? 'true' : undefined} data-readonly={!interactive ? 'true' : undefined} onKeyDown={handleKeyboard} tabIndex={0}>
      <header className="quest-game__header">
        <div className="quest-game__heading">
          <span className="quest-game__eyebrow"><Compass size={13} aria-hidden="true" /> แผนที่ภารกิจ · QUEST 01</span>
          <h2>ตามรอยแผนที่ไปให้ถึงขุมทรัพย์</h2>
        </div>
        <div className="quest-game__progress" aria-label={`ผ่านแล้ว ${answeredCount} จาก 3 ด่าน`}>
          <span>เส้นทางที่ผ่าน</span>
          <strong>{answeredCount}<small> / 3</small></strong>
          <div className="quest-game__progress-track" aria-hidden="true"><i style={{ width: `${(answeredCount / 3) * 100}%` }} /></div>
        </div>
      </header>

      {isPreview && (
        <p className="quest-game__preview-feedback" data-narrative-record="library" role="status">
          <CircleHelp size={13} aria-hidden="true" />
          <span>ตัวอย่าง 3:40 · คำตอบ “โคมไฟ” ยังไม่ถูก · ใบ้แรก {previewCurrentStatus.hintLevel ? 'พร้อมแล้ว' : `เมื่อ ${formatQuestTime(rule.firstHint)}`}</span>
        </p>
      )}

      <div className="quest-game__body">
        <section className="quest-game__map-card" aria-label="แผนที่เกม">
          <QuestMap
            activeStationId={activeStationId}
            solvedStationIds={isPreview ? ['garden'] : gameState.solvedStationIds}
            unlocked={unlocked}
            interactive={interactive}
            onSelect={handleStationSelect}
          />
        </section>

        <article className="quest-game__puzzle">
          <div className="quest-game__puzzle-topline">
            <span className="quest-game__puzzle-step">ด่าน {QUEST_STATIONS.findIndex((item) => item.id === activeStationId) + 1}</span>
            <span className={`quest-game__station-state ${stationSolved ? 'is-solved' : ''}`}>
              {stationSolved ? <><Check size={12} aria-hidden="true" /> ผ่านแล้ว</> : <><CircleHelp size={12} aria-hidden="true" /> {isPreview ? 'กำลังดูตัวอย่าง' : 'กำลังเล่น'}</>}
            </span>
          </div>
          <h3>{station.title}</h3>
          <p className="quest-game__clue">{station.clue}</p>

          <div className="quest-game__choices" role="group" aria-label={`ตัวเลือกคำตอบ: ${station.label}`}>
            {station.choices.map((choice, index) => (
              <button
                key={choice.id}
                type="button"
                className="quest-game__choice"
                disabled={!interactive || stationSolved}
                onClick={() => handleAnswer(choice.id)}
              >
                <span>{String.fromCharCode(65 + index)}</span>{choice.label}<ArrowRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>

          {!isPreview && feedback ? (
            <p className={`quest-game__feedback ${feedback.includes('ถูกต้อง') || feedback.includes('ปลดล็อก') ? 'is-success' : ''}`} role="status">{feedback}</p>
          ) : null}

          <div className="quest-game__rule-card" aria-label="สถานะเวลาและคำใบ้">
            <div className="quest-game__control-row">
              {!isPreview && <div className="quest-game__rule-clock"><Clock3 size={14} aria-hidden="true" /><span>เวลา</span><strong>{formatQuestTime(timer.seconds)}</strong></div>}
              <p className="quest-game__rule-status">{isPreview ? (previewCurrentStatus.hintLevel ? 'คำใบ้แรกพร้อมแล้ว' : `ใบ้แรกเมื่อ ${formatQuestTime(rule.firstHint)}`) : status.hintLevel === 0 ? `ใบ้แรกเมื่อ ${formatQuestTime(rule.firstHint)}` : status.hintLevel === 1 ? 'ขอคำใบ้แรกได้แล้ว' : rule.autoReveal ? 'คำใบ้สองพร้อม · เฉลยตามเวลา' : 'ขอคำใบ้สองหรือเฉลยได้แล้ว'}</p>
              <div className="quest-game__hint-actions">
                {!isPreview && <button type="button" className="quest-game__small-button quest-game__small-button--timer" aria-label={timerRunning ? 'Pause game timer' : 'Start game timer'} disabled={!interactive} onClick={() => timer.setRunning(!timerRunning)}>
                  {timerRunning ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}{timerRunning ? 'พักเวลา' : 'เริ่มเวลา'}
                </button>}
                {!isPreview && <button type="button" className="quest-game__small-button quest-game__small-button--reset" aria-label="Restart game" disabled={guided || paused || demoActive} onClick={handleReset}><RotateCcw size={12} aria-hidden="true" />ใหม่</button>}
                <button type="button" className="quest-game__small-button" disabled={!canRequestHint} onClick={handleHint}>
                  <Lightbulb size={13} aria-hidden="true" />{nextHintLevel > 2 ? 'ใบ้ครบ' : `ขอใบ้ ${nextHintLevel}`}
                </button>
                {!isPreview && <button type="button" className="quest-game__small-button" disabled={!interactive || rule.autoReveal || status.hintLevel < 2 || answerRevealed || stationSolved} onClick={handleAnswerRequest}>
                  <KeyRound size={13} aria-hidden="true" />{answerButtonLabel}
                </button>}
              </div>
            </div>
            {currentHint && !isPreview && <p className="quest-game__hint-output" role="status"><Lightbulb size={13} aria-hidden="true" /><span>คำใบ้ {requestedHintLevel}: {currentHint}</span></p>}
            {answerRevealed && <p className="quest-game__answer-output" role="status"><KeyRound size={13} aria-hidden="true" /><span>เฉลย: <strong>{activeAnswer}</strong>{rule.autoReveal ? ' · เปิดตามเวลาที่ตั้งไว้' : ' · ผู้เล่นเลือกขอ'}</span></p>}
          </div>
        </article>
      </div>

      {allSolved && <p className="quest-game__complete" role="status"><Sparkles size={15} aria-hidden="true" /> ผ่านครบทั้งสามด่านแล้ว · เกมจบแล้ว</p>}
      <details className="quest-game__details">
        <summary>วิธีเล่นและกติกาคำใบ้</summary>
        <p>เลือกด่านที่เปิดอยู่และตอบให้ถูกเพื่อปลดล็อกด่านถัดไป · เริ่มเวลาเมื่อพร้อม · กด 1–3 เพื่อเลือกด่าน และ H เพื่อขอคำใบ้</p>
        <p>ใบ้แรก {formatQuestTime(rule.firstHint)} · ใบ้ที่สอง {formatQuestTime(rule.secondHint)} · {rule.autoReveal ? 'เฉลยอัตโนมัติตามเวลา' : 'ผู้เล่นเลือกขอเฉลยเอง'}</p>
        <p>คำตอบ → ตรวจคำตอบ → ความคืบหน้า · เวลา → กติกาปัจจุบัน → คำใบ้หรือเฉลย</p>
        {isPreview && <p>เทียบตัวอย่างที่ 3:40: กติกาเดิมให้ใบ้แรกที่ {formatQuestTime(previewOldRule.firstHint)} จึงยังรอ · กติกาปัจจุบันตั้งไว้ที่ {formatQuestTime(rule.firstHint)} จึง{previewCurrentStatus.hintLevel ? 'ขอใบ้ได้' : 'ยังรอ'}</p>}
        <a className="quest-game__export-link" href={`data:text/html;charset=utf-8,${encodeURIComponent(exportPlayableQuestHtml(rule))}`} download="quest-game.html">ดาวน์โหลดเกม HTML สำหรับเล่นออฟไลน์</a>
      </details>
    </section>
  );
}

export default QuestGame;
