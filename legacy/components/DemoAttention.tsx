import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './demo-attention-cues.css';

export type DemoCueId =
  | 'source'
  | 'table-compare'
  | 'fa001-ledger'
  | 'fa001-calculated'
  | 'draft-threshold'
  | 'draft-life'
  | 'draft-start'
  | 'evaluation'
  | 'approval-proof'
  | 'experiment-proof'
  | 'knowledge'
  | 'handoff'
  | 'overview';

type CueDefinition = { label: string; resolve: () => HTMLElement | null };
type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type Placement = { left: number; top: number; side: 'top' | 'right' | 'bottom' | 'left' };

const cueLabels: Record<DemoCueId, string> = {
  source: 'แหล่งข้อมูลบัญชี',
  'table-compare': 'ผลคำนวณ · บัญชี · ส่วนต่าง',
  'fa001-ledger': 'ยอดบัญชี FA-001',
  'fa001-calculated': 'ค่าคำนวณ FA-001',
  'draft-threshold': 'เกณฑ์ราคา Laptop',
  'draft-life': 'อายุใช้งาน',
  'draft-start': 'เดือนเริ่มคิด',
  evaluation: 'ผลตรวจสอบกฎ',
  'approval-proof': 'ผลหลังใช้กฎที่อนุมัติ',
  'experiment-proof': 'ผลทดลอง · กฎจริงยังอยู่',
  knowledge: 'กฎที่บันทึกไว้',
  handoff: 'รายการที่ส่งต่อให้ตรวจ',
  overview: 'ภาพรวมของงานนี้',
};

const objectCard = (kind: string) => document.querySelector<HTMLElement>(`[data-testid="object-${kind}"]`);
const textOf = (element: Element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

function comparisonTable(): HTMLTableElement | null {
  return objectCard('table')?.querySelector<HTMLTableElement>('.data-table') ?? null;
}

function rowForAsset(table: HTMLTableElement, assetId: string): HTMLTableRowElement | null {
  return [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')]
    .find(row => textOf(row).includes(assetId.toLocaleLowerCase())) ?? null;
}

function cellForColumn(table: HTMLTableElement, row: HTMLTableRowElement, columnName: RegExp): HTMLElement | null {
  const headers = [...table.querySelectorAll<HTMLTableCellElement>('thead th')];
  const index = headers.findIndex(header => columnName.test(textOf(header)));
  return index >= 0 ? row.cells.item(index) : null;
}

function fieldInDraft(focus: string, heading: RegExp): HTMLElement | null {
  const draft = document.querySelector<HTMLElement>('[data-testid="asset-policy-draft"]');
  if (!draft) return null;
  const marked = draft.querySelector<HTMLElement>(`[data-demo-focus="${focus}"]`);
  if (marked) return marked;
  return [...draft.querySelectorAll<HTMLElement>('.asset-policy-draft__field')]
    .find(field => heading.test(textOf(field.querySelector('.asset-policy-draft__field-heading') ?? field))) ?? null;
}

function resolveCue(cue: DemoCueId): CueDefinition {
  switch (cue) {
    case 'source':
      return {
        label: cueLabels[cue],
        resolve: () => {
          const files = objectCard('source')?.querySelectorAll<HTMLElement>('.source-file');
          return [...(files ?? [])].find(file => /general ledger/.test(textOf(file))) ?? null;
        },
      };
    case 'table-compare':
      return {
        label: cueLabels[cue],
        resolve: () => comparisonTable()?.querySelector<HTMLElement>('thead tr') ?? null,
      };
    case 'fa001-ledger':
      return {
        label: cueLabels[cue],
        resolve: () => {
          const table = comparisonTable();
          const row = table && rowForAsset(table, 'FA-001');
          const tableAmount = table && row ? cellForColumn(table, row, /general ledger|ledger/i) : null;
          if (tableAmount && visibleRect(tableAmount)) return tableAmount;

          const proof = document.querySelector<HTMLElement>('[data-testid="demo-learning-proof"]');
          if (proof && /fa-001/.test(textOf(proof))) {
            const proofAmount = proof.querySelector<HTMLElement>('.learning-demo-proof__comparison > div:first-child strong');
            if (proofAmount && visibleRect(proofAmount)) return proofAmount;
          }
          return tableAmount;
        },
      };
    case 'fa001-calculated':
      return {
        label: cueLabels[cue],
        resolve: () => {
          const tableAmount = objectCard('table')?.querySelector<HTMLElement>('[aria-label="Explain calculation for FA-001"]') ?? null;
          if (tableAmount && visibleRect(tableAmount)) return tableAmount;

          const proof = document.querySelector<HTMLElement>('[data-testid="demo-learning-proof"]');
          if (proof && /fa-001/.test(textOf(proof))) {
            const proofAmount = proof.querySelector<HTMLElement>('.learning-demo-proof__comparison > div:nth-of-type(2) strong, .learning-demo-proof__single strong');
            if (proofAmount && visibleRect(proofAmount)) return proofAmount;
          }
          return tableAmount;
        },
      };
    case 'draft-threshold':
      return { label: cueLabels[cue], resolve: () => fieldInDraft('draft-threshold', /threshold/) };
    case 'draft-life':
      return { label: cueLabels[cue], resolve: () => fieldInDraft('draft-useful-life', /useful life/) };
    case 'draft-start':
      return { label: cueLabels[cue], resolve: () => fieldInDraft('draft-start', /start convention/) };
    case 'evaluation':
      return {
        label: cueLabels[cue],
        resolve: () => document.querySelector<HTMLElement>('[data-testid="workspace-inspector"] .inspector__evaluation-banner')
          ?? objectCard('evaluation')?.querySelector<HTMLElement>('.evaluation-content')
          ?? null,
      };
    case 'approval-proof':
      return {
        label: cueLabels[cue],
        resolve: () => document.querySelector<HTMLElement>('[data-testid="demo-learning-proof"][data-focus="approved"] .learning-demo-proof__comparison')
          ?? document.querySelector<HTMLElement>('[data-testid="demo-learning-proof"][data-focus="approved"] .learning-demo-proof__single'),
      };
    case 'experiment-proof':
      return {
        label: cueLabels[cue],
        resolve: () => document.querySelector<HTMLElement>('[data-testid="demo-learning-proof"][data-focus="experiment"] .learning-demo-proof__comparison'),
      };
    case 'knowledge':
      return {
        label: cueLabels[cue],
        resolve: () => {
          const constellation = document.querySelector<HTMLElement>('[data-testid="knowledge-constellation"]');
          if (constellation) {
            const path = constellation.querySelector<HTMLElement>('[data-testid="guided-knowledge-path"]');
            if (!path) return null;
            const approvedStep = path.querySelector<HTMLElement>('[data-testid="guided-knowledge-step"][data-step="4"]');
            if (approvedStep && visibleRect(approvedStep)) return approvedStep;
            return path.querySelector<HTMLElement>('.guided-proof__header');
          }
          return objectCard('knowledge')?.querySelector<HTMLElement>('.knowledge-content p') ?? null;
        },
      };
    case 'handoff':
      return {
        label: cueLabels[cue],
        resolve: () => document.querySelector<HTMLElement>('[data-testid="workspace-inspector"] .inspector__handoff-card'),
      };
    case 'overview':
      return {
        label: cueLabels[cue],
        resolve: () => document.querySelector<HTMLElement>('[data-testid="workspace-overview"] .workspace-overview__hero'),
      };
  }
}

function rectOf(rect: DOMRect): Rect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function visibleRect(element: HTMLElement): Rect | null {
  if (!element.isConnected || element.getClientRects().length === 0) return null;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.04) return null;

  let rect = rectOf(element.getBoundingClientRect());
  if (rect.width < 5 || rect.height < 5) return null;
  let ancestor: HTMLElement | null = element.parentElement;
  while (ancestor && ancestor !== document.documentElement) {
    const ancestorStyle = window.getComputedStyle(ancestor);
    if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden' || Number(ancestorStyle.opacity) < 0.04) return null;
    const clipsX = ancestorStyle.overflowX !== 'visible';
    const clipsY = ancestorStyle.overflowY !== 'visible';
    if (clipsX || clipsY) {
      const clip = rectOf(ancestor.getBoundingClientRect());
      rect = {
        left: clipsX ? Math.max(rect.left, clip.left) : rect.left,
        right: clipsX ? Math.min(rect.right, clip.right) : rect.right,
        top: clipsY ? Math.max(rect.top, clip.top) : rect.top,
        bottom: clipsY ? Math.min(rect.bottom, clip.bottom) : rect.bottom,
        width: 0,
        height: 0,
      };
      rect.width = rect.right - rect.left;
      rect.height = rect.bottom - rect.top;
      if (rect.width < 5 || rect.height < 5) return null;
    }
    ancestor = ancestor.parentElement;
  }

  const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  if (rect.left + rect.width / 2 < viewport.left || rect.left + rect.width / 2 > viewport.right
    || rect.top + rect.height / 2 < viewport.top || rect.top + rect.height / 2 > viewport.bottom) return null;
  return rect;
}

function isVisibleElement(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) >= 0.04;
}

const importantSelector = 'button,input,select,textarea,a,[role="button"],th,td,h1,h2,h3,h4,p,strong,small,dt,dd,li,label';

function choosePlacement(target: Rect, bubbleWidth: number, bubbleHeight: number, owner: HTMLElement | null, targetElement: HTMLElement): Placement | null {
  const gap = 8;
  const viewport = { left: 8, top: 8, right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
  const centerX = target.left + target.width / 2;
  const centerY = target.top + target.height / 2;
  const candidates: Placement[] = [
    { side: 'right', left: target.right + gap, top: centerY - bubbleHeight / 2 },
    { side: 'left', left: target.left - bubbleWidth - gap, top: centerY - bubbleHeight / 2 },
    { side: 'top', left: centerX - bubbleWidth / 2, top: target.top - bubbleHeight - gap },
    { side: 'bottom', left: centerX - bubbleWidth / 2, top: target.bottom + gap },
  ];
  const targetClearance = { left: target.left - 4, top: target.top - 4, right: target.right + 4, bottom: target.bottom + 4, width: target.width + 8, height: target.height + 8 };
  const withinViewport = (candidate: Placement, width: number, height: number) => candidate.left >= viewport.left && candidate.top >= viewport.top
    && candidate.left + width <= viewport.right && candidate.top + height <= viewport.bottom;
  const contentRects = owner
    ? [...owner.querySelectorAll<HTMLElement>(importantSelector)]
      .filter(element => element !== targetElement && isVisibleElement(element))
      .map(element => rectOf(element.getBoundingClientRect()))
    : [];
  const otherSurfaceRects = [...document.querySelectorAll<HTMLElement>('.canvas-card,.inspector,.demo-player')]
    .filter(element => element !== owner && !element.contains(targetElement) && isVisibleElement(element))
    .map(element => rectOf(element.getBoundingClientRect()));

  const safe = (candidate: Placement) => {
    const box = { left: candidate.left, top: candidate.top, right: candidate.left + bubbleWidth, bottom: candidate.top + bubbleHeight, width: bubbleWidth, height: bubbleHeight };
    if (!withinViewport(candidate, bubbleWidth, bubbleHeight) || intersects(box, targetClearance)) return false;
    if (contentRects.some(rect => intersects(box, rect)) || otherSurfaceRects.some(rect => intersects(box, rect))) return false;
    return true;
  };
  const near = candidates.find(safe);
  if (near) return near;

  // If the target is embedded in a dense table or form, tuck the note just
  // outside its containing surface, aligned with the target's row/field.
  if (owner) {
    const bounds = rectOf(owner.getBoundingClientRect());
    const outside: Placement[] = [
      { side: 'right', left: bounds.right + gap, top: centerY - bubbleHeight / 2 },
      { side: 'left', left: bounds.left - bubbleWidth - gap, top: centerY - bubbleHeight / 2 },
      { side: 'top', left: centerX - bubbleWidth / 2, top: bounds.top - bubbleHeight - gap },
      { side: 'bottom', left: centerX - bubbleWidth / 2, top: bounds.bottom + gap },
    ];
    const external = outside.find(candidate => {
      const box = { left: candidate.left, top: candidate.top, right: candidate.left + bubbleWidth, bottom: candidate.top + bubbleHeight, width: bubbleWidth, height: bubbleHeight };
      return withinViewport(candidate, bubbleWidth, bubbleHeight)
        && !otherSurfaceRects.some(rect => intersects(box, rect))
        && !contentRects.some(rect => intersects(box, rect));
    });
    if (external) return external;
  }
  return null;
}

export default function DemoAttention({ cue }: { cue: DemoCueId | null }) {
  const highlightRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const highlight = highlightRef.current;
    const label = labelRef.current;
    if (!cue || !highlight || !label) return;

    const trackingWindowMs = 1_000;
    let frame: number | null = null;
    let trackingUntil = 0;
    let lastSample = Number.NEGATIVE_INFINITY;
    let lastGeometryKey = '';
    let targetDirty = true;
    let target: HTMLElement | null = null;
    let owner: HTMLElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    const definition = resolveCue(cue);

    const hide = () => {
      highlight.style.display = 'none';
      label.style.display = 'none';
      label.style.visibility = 'hidden';
    };

    const track = (resolveTarget = false) => {
      if (resolveTarget) targetDirty = true;
      trackingUntil = Math.max(trackingUntil, performance.now() + trackingWindowMs);
      if (frame === null) frame = window.requestAnimationFrame(sampleFrame);
    };

    const refreshTarget = () => {
      const next = definition.resolve();
      targetDirty = false;
      if (next === target) return;
      target = next;
      owner = target?.closest<HTMLElement>('.canvas-card,.inspector,.constellation-guided-proof') ?? null;
      lastGeometryKey = '';
      resizeObserver?.disconnect();
      if (target && resizeObserver) {
        resizeObserver.observe(target);
        if (owner && owner !== target) resizeObserver.observe(owner);
      }
      if (!target) hide();
    };

    const geometryKey = (targetRect: Rect, ownerRect: Rect | null) => {
      const quantize = (value: number) => Math.round(value * 2) / 2;
      const parts = [targetRect.left, targetRect.top, targetRect.width, targetRect.height,
        ownerRect?.left ?? -1, ownerRect?.top ?? -1, ownerRect?.width ?? -1, ownerRect?.height ?? -1,
        window.innerWidth, window.innerHeight];
      return parts.map(quantize).join(':');
    };

    const paint = (targetRect: Rect, targetElement: HTMLElement, ownerElement: HTMLElement | null) => {

      const padding = 3;
      highlight.style.left = `${targetRect.left - padding}px`;
      highlight.style.top = `${targetRect.top - padding}px`;
      highlight.style.width = `${targetRect.width + padding * 2}px`;
      highlight.style.height = `${targetRect.height + padding * 2}px`;
      highlight.style.borderRadius = targetRect.height <= 34 ? '7px' : '10px';

      label.style.display = 'block';
      label.style.visibility = 'hidden';
      const bubbleWidth = label.offsetWidth;
      const bubbleHeight = label.offsetHeight;
      const placement = choosePlacement(targetRect, bubbleWidth, bubbleHeight, ownerElement, targetElement);
      const nativeDraftFocus = cue.startsWith('draft-') && targetElement.closest('[data-demo-focus-active="true"]') !== null;
      if (!placement) {
        label.style.display = 'none';
        label.style.visibility = 'hidden';
        highlight.style.display = nativeDraftFocus ? 'none' : 'block';
        return;
      }
      label.style.left = `${placement.left}px`;
      label.style.top = `${placement.top}px`;
      label.dataset.side = placement.side;
      label.style.visibility = 'visible';
      highlight.style.display = nativeDraftFocus ? 'none' : 'block';
    };

    const sample = () => {
      if (targetDirty) refreshTarget();
      let currentTarget = target;
      let targetRect = currentTarget ? visibleRect(currentTarget) : null;
      if (!targetRect) {
        // Camera transforms can move a preferred target offscreen without a
        // semantic DOM change. Re-resolve during the bounded tracking window
        // so cues can switch to their visible proof fallback as the camera pans.
        targetDirty = true;
        refreshTarget();
        currentTarget = target;
        targetRect = currentTarget ? visibleRect(currentTarget) : null;
      }
      if (!currentTarget || !targetRect) {
        if (lastGeometryKey !== 'hidden') hide();
        lastGeometryKey = 'hidden';
        return;
      }
      const ownerRect = owner ? rectOf(owner.getBoundingClientRect()) : null;
      const nextGeometryKey = geometryKey(targetRect, ownerRect);
      if (nextGeometryKey === lastGeometryKey) return;
      lastGeometryKey = nextGeometryKey;
      paint(targetRect, currentTarget, owner);
    };

    function sampleFrame(time: number) {
      if (time - lastSample >= 32) {
        lastSample = time;
        sample();
      }
      if (performance.now() < trackingUntil) frame = window.requestAnimationFrame(sampleFrame);
      else frame = null;
    }

    const refreshGeometry = () => track(false);
    window.addEventListener('resize', refreshGeometry, { passive: true });
    window.addEventListener('scroll', refreshGeometry, { capture: true, passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(refreshGeometry);
    }
    const app = document.querySelector<HTMLElement>('.app');
    if (app && typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(records => {
        const relevant = records.filter(record => {
          const node = record.target instanceof Element ? record.target : record.target.parentElement;
          return !node?.closest('.demo-attention-overlay,.demo-player,.react-flow__edge');
        });
        if (relevant.length === 0) return;
        const resolveTarget = relevant.some(record => record.type === 'childList'
          || (record.type === 'attributes' && ['data-testid', 'data-focus', 'data-demo-focus', 'data-demo-focus-active', 'data-step'].includes(record.attributeName ?? '')));
        track(resolveTarget);
      });
      mutationObserver.observe(app, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        attributeFilter: ['class', 'style', 'data-testid', 'data-focus', 'data-demo-focus', 'data-demo-focus-active', 'data-step', 'aria-hidden'],
      });
    }
    track(true);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', refreshGeometry);
      window.removeEventListener('scroll', refreshGeometry, true);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      hide();
    };
  }, [cue]);

  if (!cue || typeof document === 'undefined') return null;
  return createPortal(
    <div className="demo-attention-overlay" aria-hidden="true">
      <div className="demo-attention__target" ref={highlightRef} data-testid="demo-attention-target" />
      <div className="demo-attention__label" ref={labelRef} data-testid="demo-attention" data-demo-cue={cue}>{cueLabels[cue]}</div>
    </div>,
    document.body,
  );
}
