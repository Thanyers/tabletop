import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const motion = resolve(here, '..');
const narrationPath = resolve(motion, 'narration-r5.json');
const narration = JSON.parse(await readFile(narrationPath, 'utf8'));
const fps = 30;
const voiceDir = resolve(motion, 'public', 'audio', narration.assetDirectory);

const cueSpec = {
  'tools.pen.arrive': ['tools', 'pen', 'start', 0.02],
  'tools.pen.grip': ['tools', 'grip', 'start', 0.09],
  'tools.hammer.arrive': ['tools', 'hammer', 'start', 0.24],
  'tools.hammer.handle': ['tools', 'handle', 'start', 0.31],
  'tools.chair.arrive': ['tools', 'chair', 'start', 0.43],
  'tools.chair.backrest': ['tools', 'backrest', 'start', 0.52],
  'tools.chair.armrests': ['tools', 'armrests', 'start', 0.61],
  'tools.chair.wheels': ['tools', 'wheels', 'start', 0.69],
  'tools.recap': ['tools', 'shaping', 'start', 0.79],
  'friction.question': ['friction', 'So', 'start', 0.03],
  'friction.app': ['friction', 'app', 'start', 0.2],
  'friction.menus': ['friction', 'menus', 'start', 0.39],
  'friction.workflow': ['friction', 'workflow', 'start', 0.55],
  'friction.restart': ['friction', 'again', 'start', 0.83],
  'reversal.idea': ['reversal', 'What', 'start', 0.03],
  'reversal.brand': ['reversal', 'Tabletop', 'start', 0.22],
  'reversal.describe': ['reversal', 'Describe', 'start', 0.43],
  'reversal.review': ['reversal', 'Review', 'start', 0.57],
  'reversal.apply': ['reversal', 'Put', 'start', 0.67],
  'reversal.canvas': ['reversal', 'canvas', 'start', 0.75],
  'reversal.keepShaping': ['reversal', 'Then', 'start', 0.81],
  'table.typeStart': ['table', 'Type', 'start', 0.26],
  'table.send': ['table', 'and', 'end', 0.48],
  'table.review': ['table', 'Review', 'start', 0.57],
  'table.apply': ['table', 'apply', 'start', 0.66],
  'table.result': ['table', 'ready', 'start', 0.76],
  'quick.typeStart': ['quick-request', 'So', 'start', 0.39],
  'quick.send': ['quick-request', 'buttons', 'end', 0.79],
  'quick.review': ['quick-use', 'Review', 'start', 0.02],
  'quick.apply': ['quick-use', 'Apply', 'start', 0.17],
  'quick.click': ['quick-use', 'Coffee', 'start', 0.31],
  'quick.result': ['quick-use', 'updates', 'start', 0.67],
  'chart.typeStart': ['chart', "What's", 'start', 0.02],
  'chart.send': ['chart', 'chart', 'end', 0.31],
  'chart.review': ['chart', 'Review', 'start', 0.39],
  'chart.apply': ['chart', 'apply', 'start', 0.48],
  'chart.result': ['chart', 'reads', 'start', 0.59],
  'discount10.typeStart': ['discount10', 'Add', 'start', 0.2],
  'discount10.send': ['discount10', 'discount', 'end', 0.43],
  'discount10.review': ['discount10', 'Review', 'start', 0.52],
  'discount10.apply': ['discount10', 'apply', 'start', 0.61],
  'discount10.result': ['discount10', 'Net', 'start', 0.78],
  'discount20.select': ['discount20', 'Select', 'start', 0.29],
  'discount20.send': ['discount20', 'change', 'end', 0.49],
  'discount20.review': ['discount20', 'check', 'start', 0.62],
  'discount20.apply': ['discount20', 'Apply', 'start', 0.73],
  'discount20.result': ['discount20', 'Net', 'start', 0.81],
  'close.logoStart': ['close', 'Tabletop', 'start', 0.64],
};

const wordsFor = async (segment) => {
  const path = resolve(voiceDir, `${segment.id}.jsonl`);
  try {
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean);
    const words = lines.map((line) => JSON.parse(line)).filter((word) => word.type === 'WordBoundary');
    if (!words.length) return null;
    return words.map((word) => {
      const startSeconds = word.start ?? word.startTime ?? (word.offset / 10_000_000);
      const endSeconds = word.end ?? word.endTime ?? (word.endOffset !== undefined
        ? word.endOffset / 10_000_000
        : startSeconds + (word.duration ?? 0) / 10_000_000);
      const relativeStart = startSeconds > 10000 ? startSeconds / 1000 : startSeconds;
      const relativeEnd = endSeconds > 10000 ? endSeconds / 1000 : endSeconds;
      const startFrame = Math.round((segment.start + relativeStart) * fps);
      const endFrame = Math.max(startFrame + 1, Math.round((segment.start + relativeEnd) * fps));
      return { text: word.text, startFrame, endFrame, estimated: false };
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
};

const estimatedWordsFor = (segment) => {
  const tokens = segment.text.match(/[^\s]+/g) ?? [];
  const weights = tokens.map((token) => Math.max(1, token.replace(/[^\p{L}\p{N}]/gu, '').length) ** 0.7);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const startFrame = Math.round(segment.start * fps);
  const speechFrames = Math.round(segment.duration * fps);
  let cursor = startFrame;
  return tokens.map((text, index) => {
    const length = Math.max(1, Math.round((weights[index] / totalWeight) * speechFrames));
    const word = { text, startFrame: cursor, endFrame: cursor + length, estimated: true };
    cursor += length;
    return word;
  });
};

const segments = [];
for (const source of narration.segments) {
  const startFrame = Math.round(source.start * fps);
  const durationFrames = Math.round(source.duration * fps);
  const endFrame = Math.round(source.end * fps);
  const measured = await wordsFor(source);
  segments.push({
    id: source.id,
    startFrame,
    endFrame,
    voiceStartFrame: startFrame,
    voiceEndFrame: startFrame + durationFrames,
    words: measured ?? estimatedWordsFor(source),
  });
}

const segmentById = new Map(segments.map((segment) => [segment.id, segment]));
const findWord = (segmentId, token, edge, fallbackRatio) => {
  const segment = segmentById.get(segmentId);
  const normalized = token.toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '');
  const match = segment.words.find((word) => word.text.toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '') === normalized);
  if (match) return edge === 'end' ? match.endFrame : match.startFrame;
  return Math.round(segment.startFrame + (segment.endFrame - segment.startFrame) * fallbackRatio);
};

const cues = Object.fromEntries(Object.entries(cueSpec).map(([name, [segment, token, edge, fallback]]) => [
  name,
  findWord(segment, token, edge, fallback),
]));
const frameAfter = (frame, amount) => Math.min(narration.durationFrames - 1, frame + amount);
// The photographed writing hand is the opening visual and stays in view as the
// narration names the first tool; only its grip highlight waits for that word.
cues['tools.pen.arrive'] = segmentById.get('tools').startFrame;
// Start the last prompt just after the saved rule is selected so it has a
// natural typing window while the narrator describes the change.
cues['discount20.typeStart'] = frameAfter(cues['discount20.select'], 18);
// The quick-sale buttons must be in place before the later, narrated click.
cues['quick.buttonsReady'] = cues['quick.apply'] + 12;
// Let the buttons finish settling as the narrator reaches "Coffee", then
// register the click and update the same table a short beat later.
cues['quick.click'] = frameAfter(cues['quick.click'], 8);
cues['quick.salesUpdated'] = frameAfter(cues['quick.click'], 10);
const request = (id, message, title, detail, typeStartCue, sendCue, reviewCue, applyCue, resultCue, options = {}) => {
  const { minimumResultAfterApply = 24, ...requestOptions } = options;
  const typeStart = cues[typeStartCue];
  const send = Math.max(typeStart + 10, cues[sendCue]);
  const reviewed = Math.max(cues[reviewCue], send + 18);
  const apply = Math.max(cues[applyCue], reviewed + 18);
  const result = Math.max(cues[resultCue], apply + minimumResultAfterApply);
  return {
    id,
    message,
    title,
    detail,
    typeStart,
    send,
    draftEnd: Math.max(send + 6, Math.min(reviewed - 6, frameAfter(send, 27))),
    reviewed,
    applyStart: Math.max(reviewed + 8, apply - 7),
    apply,
    result,
    ...requestOptions,
  };
};

const requests = [
  request('table', 'Make me a sales table for coffee and cake.', 'Sales table · coffee + cake', 'Coffee and cake with quantities, prices, and line totals.', 'table.typeStart', 'table.send', 'table.review', 'table.apply', 'table.result', { label: 'Sales table' }),
  request('quick', 'Add quick-sale buttons.', 'One-click sale buttons', 'Coffee +1 and Cake +1.', 'quick.typeStart', 'quick.send', 'quick.review', 'quick.apply', 'quick.buttonsReady', { minimumResultAfterApply: 12, label: 'Quick-sale buttons' }),
  request('chart', 'Add a chart.', 'Sales by item', 'Coffee ฿100 · Cake ฿150 from the same rows.', 'chart.typeStart', 'chart.send', 'chart.review', 'chart.apply', 'chart.result', { label: 'Sales chart' }),
  request('discount10', 'Add a 10% discount.', '10% discount rule', '฿250 × 90% = ฿225 net.', 'discount10.typeStart', 'discount10.send', 'discount10.review', 'discount10.apply', 'discount10.result', { label: '10% discount' }),
  request('discount20', 'Change this rule to 20%.', 'Change the selected rule to 20%', '฿250 × 80% = ฿200 net.', 'discount20.typeStart', 'discount20.send', 'discount20.review', 'discount20.apply', 'discount20.result', { label: '20% discount' }),
];
const letters = (text) => Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text), ({ segment }) => segment);
for (const item of requests) {
  item.letters = letters(item.message);
  item.completeAt = Math.max(item.typeStart + 1, item.send - 8);
  item.typingStep = (item.completeAt - item.typeStart) / item.letters.length;
}

const reversalWords = segmentById.get('reversal').words;
const lastReversalIt = [...reversalWords].reverse().find((word) =>
  word.text.toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '') === 'it',
);
cues['reversal.keepShapingEnd'] = lastReversalIt?.endFrame ?? frameAfter(cues['reversal.keepShaping'], 40);
const boardStart = frameAfter(cues['reversal.keepShapingEnd'], 6);
const timeline = {
  fps,
  durationInFrames: narration.durationFrames,
  timingStatus: narration.timingStatus,
  sourceNarration: 'narration-r5.json',
  segments,
  cues: {
    ...cues,
    'intro.start': segments[0].startFrame,
    'intro.end': segments[2].endFrame,
    'board.start': boardStart,
    'board.end': cues['close.logoStart'],
    'close.start': segmentById.get('close').startFrame,
  },
  requests,
};

const soundCues = {
  fps,
  durationInFrames: narration.durationFrames,
  timingStatus: narration.timingStatus,
  typing: requests.map(({ typeStart, completeAt }) => ({ start: typeStart, end: completeAt })),
  send: requests.map(({ send }) => send),
  review: requests.map(({ reviewed }) => reviewed),
  apply: requests.map(({ apply }) => apply),
  result: requests.map(({ result }) => result),
  coffeeClick: cues['quick.click'],
  coffeeUpdate: cues['quick.salesUpdated'],
  introPencil: [{ start: cues['tools.pen.arrive'], end: frameAfter(cues['tools.pen.grip'], 20) }],
  introClicks: [cues['tools.hammer.handle'], cues['tools.chair.arrive'], cues['tools.chair.backrest'], cues['tools.chair.armrests'], cues['tools.chair.wheels']],
  transition: [segments[1].startFrame, segments[2].startFrame, boardStart, cues['close.logoStart']],
};

await writeFile(resolve(motion, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
await writeFile(resolve(motion, 'sound-cues.json'), `${JSON.stringify(soundCues, null, 2)}\n`);
console.log(`${timeline.timingStatus}: ${segments.length} segments, ${timeline.durationInFrames} frames; wrote timeline.json and sound-cues.json.`);
