import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile } from 'remotion';
import { BrandMark } from './BrandMark.jsx';

const clamp = (frame, start, end) => interpolate(frame, [start, end], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});

const rise = (frame, start, end, distance = 24) => ({
  opacity: clamp(frame, start, end),
  transform: `translateY(${(1 - clamp(frame, start, end)) * distance}px)`,
});

function ChairStage({ frame, cues }) {
  const parts = [
    { id: 'seat', cue: cues['tools.chair.arrive'], mask: 'inset(47% 23% 34% 22%)', label: 'SEAT' },
    { id: 'backrest', cue: cues['tools.chair.backrest'], mask: 'inset(9% 28% 46% 30%)', label: 'BACKREST' },
    { id: 'armrests', cue: cues['tools.chair.armrests'], mask: 'inset(43% 12% 38% 10%)', label: 'ARMRESTS' },
    { id: 'wheels', cue: cues['tools.chair.wheels'], mask: 'inset(63% 2% 2% 18%)', label: 'WHEELS' },
  ];
  const labelVisible = (cue) => frame >= cue;
  const completeReveal = clamp(frame, cues['tools.chair.wheels'] + 13, cues['tools.chair.wheels'] + 27);

  return <div className="physical-card physical-card--chair" style={rise(frame, cues['tools.chair.arrive'], cues['tools.chair.arrive'] + 18, 22)}>
    <div className="physical-eyebrow">CHAIR</div>
    <div className="chair-photo">
      {parts.map((part) => {
        const reveal = clamp(frame, part.cue, part.cue + 15);
        return <div key={part.id} className={`chair-photo-part chair-photo-part--${part.id}`} style={{
          clipPath: part.mask,
          opacity: reveal * (1 - completeReveal),
          transform: `translateY(${(1 - reveal) * 5}px)`,
        }}>
          <Img src={staticFile('objects/office-chair-isolated.jpg')} />
        </div>;
      })}
      <div className="chair-photo-complete" style={{ opacity: completeReveal }}>
        <Img src={staticFile('objects/office-chair-isolated.jpg')} />
      </div>
      <span className="chair-fit-line chair-fit-line--back" style={{ opacity: clamp(frame, cues['tools.chair.backrest'] + 3, cues['tools.chair.backrest'] + 15) * (1 - completeReveal) }} />
      <span className="chair-fit-line chair-fit-line--arm" style={{ opacity: clamp(frame, cues['tools.chair.armrests'] + 3, cues['tools.chair.armrests'] + 15) * (1 - completeReveal) }} />
      <span className="chair-fit-line chair-fit-line--wheel" style={{ opacity: clamp(frame, cues['tools.chair.wheels'] + 3, cues['tools.chair.wheels'] + 15) * (1 - completeReveal) }} />
    </div>
    <div className="chair-stages">
      {parts.slice(1).map((part) => <span
        key={part.id}
        className={labelVisible(part.cue) ? 'chair-stage chair-stage--on' : 'chair-stage'}
        style={{ opacity: clamp(frame, part.cue, part.cue + 15) }}
      >{part.label}</span>)}
    </div>
  </div>;
}

function ToolsScene({ frame, cues }) {
  const grip = clamp(frame, cues['tools.pen.grip'], cues['tools.pen.grip'] + 12);
  const handle = clamp(frame, cues['tools.hammer.handle'], cues['tools.hammer.handle'] + 12);
  return <AbsoluteFill className="thesis-scene thesis-scene--tools">
    <div className="thesis-headline" style={rise(frame, cues['tools.pen.arrive'] - 5, cues['tools.pen.arrive'] + 14)}>
      <span className="thesis-kicker">BUILT AROUND PEOPLE</span>
      <h1>Good tools <em>fit us.</em></h1>
    </div>

    <div className="tool-horizon" />
    <div className="physical-card physical-card--pen" style={rise(frame, cues['tools.pen.arrive'], cues['tools.pen.arrive'] + 15)}>
      <div className="physical-eyebrow">PEN</div>
      <div className="pen-photo">
        <Img src={staticFile('objects/writing-hand.jpg')} />
        <span className="pen-grip-ring" style={{ opacity: grip, transform: `scale(${0.68 + grip * 0.32})` }} />
        <span className="tool-callout tool-callout--pen" style={rise(frame, cues['tools.pen.grip'], cues['tools.pen.grip'] + 12, 8)}>
          <i />A grip that fits
        </span>
      </div>
    </div>

    <div className="physical-card physical-card--hammer" style={rise(frame, cues['tools.hammer.arrive'], cues['tools.hammer.arrive'] + 18)}>
      <div className="physical-eyebrow">HAMMER</div>
      <div className="hammer-photo">
        <Img src={staticFile('objects/hammer-hand.jpg')} />
        <span className="hammer-handle-mark" style={{ opacity: handle, transform: `scaleY(${0.7 + handle * 0.3})` }} />
      <span className="tool-callout tool-callout--hammer" style={rise(frame, cues['tools.hammer.handle'], cues['tools.hammer.handle'] + 12, 8)}>
          <i />A handle to hold
        </span>
      </div>
    </div>

    <ChairStage frame={frame} cues={cues} />
    <div className="tools-summary" style={rise(frame, cues['tools.recap'], cues['tools.recap'] + 16, 12)}>
      <BrandMark frame={frame - cues['tools.recap']} size={19} staticMark />
      <span>We keep shaping tools around the people who use them.</span>
    </div>
  </AbsoluteFill>;
}

function AppStack({ frame, cues }) {
  const app = clamp(frame, cues['friction.app'], cues['friction.app'] + 16);
  const menu = clamp(frame, cues['friction.menus'], cues['friction.menus'] + 18);
  const workflow = clamp(frame, cues['friction.workflow'], cues['friction.workflow'] + 18);
  const restart = clamp(frame, cues['friction.restart'], cues['friction.restart'] + 18);
  return <AbsoluteFill className="thesis-scene thesis-scene--friction">
    <div className="friction-headline" style={rise(frame, cues['friction.question'], cues['friction.question'] + 12)}>
      <span className="thesis-kicker">SOFTWARE OFTEN REVERSES THE DEAL</span>
      <h1>Then we adapt to <em>the software.</em></h1>
    </div>
    <div className="app-workbench">
      <div className="app-choice" style={{ opacity: app, transform: `translateY(${(1 - app) * 20}px)` }}>
        <div className="workbench-label"><span>01</span> PICK AN APP</div>
        <div className="app-tile app-tile--selected"><b>Sales</b><small>TABLES</small><i>↗</i></div>
        <div className="app-tile"><b>Reports</b><small>CHARTS</small><i>↗</i></div>
        <div className="app-tile"><b>Tasks</b><small>WORKFLOWS</small><i>↗</i></div>
      </div>

      <div className="workbench-connector" style={{ opacity: menu, transform: `scaleX(${menu})` }}><i /></div>

      <div className="menu-choice" style={{ opacity: menu, transform: `translateY(${(1 - menu) * 17}px)` }}>
        <div className="workbench-label"><span>02</span> LEARN ITS MENUS</div>
        <div className="menu-window">
          <div className="menu-window-top"><b>SALES TABLE</b><i>•••</i></div>
          <div className="menu-line menu-line--active"><span>Import</span><b>›</b></div>
          <div className="menu-line"><span>Format</span><b>›</b></div>
          <div className="menu-line"><span>Filter</span><b>›</b></div>
          <div className="menu-line"><span>Formula</span><b>›</b></div>
          <div className="menu-flyout"><i />Field settings</div>
        </div>
      </div>

      <svg className="workflow-route" viewBox="0 0 960 270" aria-hidden="true" style={{ opacity: workflow }}>
        <path d="M80 218 C150 218 150 132 232 132 L355 132 C425 132 426 218 505 218 L650 218 C718 218 728 132 803 132 L896 132" pathLength="1" style={{ strokeDasharray: `${workflow} 1` }} />
        <circle cx="80" cy="218" r="8" /><circle cx="896" cy="132" r="8" />
      </svg>
      <div className="workflow-label" style={{ opacity: workflow }}><span>03</span> BEND YOUR WORK TO FIT</div>
      <div className="workflow-chips" style={{ opacity: workflow, transform: `translateY(${(1 - workflow) * 14}px)` }}>
        <span>Write the sale</span><b>›</b><span>Open a menu</span><b>›</b><span>Move the data</span><b>›</b><span>Rebuild a total</span>
      </div>
      <div className="restart-loop" style={{ opacity: restart, transform: `scale(${0.8 + restart * 0.2}) rotate(${(1 - restart) * -18}deg)` }}>
        <span>NEEDS CHANGE?</span><b>↻</b><strong>START AGAIN</strong>
      </div>
    </div>
  </AbsoluteFill>;
}

function ReversalScene({ frame, cues }) {
  const title = clamp(frame, cues['reversal.idea'], cues['reversal.idea'] + 14);
  const wordmark = clamp(frame, cues['reversal.brand'] - 4, cues['reversal.brand'] + 12);
  return <AbsoluteFill className="thesis-scene thesis-scene--reversal">
    <div className="reversal-question" style={{ opacity: title, transform: `translateY(${(1 - title) * 16}px)` }}>
      <span className="thesis-kicker">WHAT IF THE TOOL CHANGED?</span>
      <h1>What if tools could <em>change with you?</em></h1>
    </div>
    <div className="reversal-answer" style={{ opacity: wordmark, transform: `translateY(${(1 - wordmark) * 18}px)` }}>
      <BrandMark frame={frame - cues['reversal.brand']} size={48} />
      <div className="answer-name">tabletop<span>.</span></div>
      <div className="answer-steps">
        <span style={{ opacity: clamp(frame, cues['reversal.describe'], cues['reversal.describe'] + 8) }}>Describe</span>
        <i style={{ opacity: clamp(frame, cues['reversal.describe'] + 8, cues['reversal.describe'] + 14) }}>→</i>
        <span style={{ opacity: clamp(frame, cues['reversal.review'], cues['reversal.review'] + 8) }}>Review</span>
        <i style={{ opacity: clamp(frame, cues['reversal.review'] + 8, cues['reversal.review'] + 14) }}>→</i>
        <span style={{ opacity: clamp(frame, cues['reversal.apply'], cues['reversal.apply'] + 8) }}>Apply</span>
        <i style={{ opacity: clamp(frame, cues['reversal.apply'] + 8, cues['reversal.apply'] + 14) }}>→</i>
        <b style={{ opacity: clamp(frame, cues['reversal.keepShaping'], cues['reversal.keepShaping'] + 8) }}>Keep shaping</b>
      </div>
    </div>
  </AbsoluteFill>;
}

export function ThesisIntro({ frame, phase, cues }) {
  if (phase === 'tools') return <ToolsScene frame={frame} cues={cues} />;
  if (phase === 'friction') return <AppStack frame={frame} cues={cues} />;
  return <ReversalScene frame={frame} cues={cues} />;
}
