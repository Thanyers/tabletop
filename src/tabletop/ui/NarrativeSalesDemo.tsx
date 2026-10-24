import { ArrowDown, ArrowRight, Check, RotateCcw, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LandingLanguage } from './landing-copy';
import './narrative-sales-demo.css';

type Chapter = 1 | 2 | 3 | 4 | 5;
type Phase = 'idle' | 'typing' | 'ready' | 'sent' | 'reviewed' | 'applied';
type Product = 'coffee' | 'cake';
type Notice = 'choose' | 'typing' | 'ready' | 'sent' | 'reviewed' | 'table' | 'quick' | 'chart' | 'discount10' | 'discount20' | 'sale';

type DemoState = {
  chapter: Chapter;
  maxChapter: Chapter;
  phase: Phase;
  request: string;
  requestIsPreset: boolean;
  quantities: Record<Product, number>;
  tableApplied: boolean;
  quickActionsApplied: boolean;
  chartApplied: boolean;
  discount: 0 | 10 | 20;
  savedTenPercent: boolean;
  notice: Notice;
  lastSale: Product | null;
};

const requests: Record<LandingLanguage, Record<Chapter, string>> = {
  en: {
    1: 'Make a sales table for coffee and cake.',
    2: 'Add quick-sale buttons that increase quantity once.',
    3: 'Add a sales chart grouped by product.',
    4: 'Try a 10% afternoon discount.',
    5: 'Change this discount rule to 20%.',
  },
  th: {
    1: 'ช่วยทำโต๊ะจดขายกาแฟกับเค้ก',
    2: 'เพิ่มปุ่มขาย กดครั้งเดียวเพิ่มจำนวน',
    3: 'เพิ่มกราฟยอดขายแยกตามสินค้า',
    4: 'ลองโปรช่วงบ่าย ลด 10%',
    5: 'เปลี่ยนกฎส่วนลดนี้เป็น 20%',
  },
};

const initialState = (): DemoState => ({
  chapter: 1,
  maxChapter: 1,
  phase: 'idle',
  request: '',
  requestIsPreset: true,
  quantities: { coffee: 3, cake: 3 },
  tableApplied: false,
  quickActionsApplied: false,
  chartApplied: false,
  discount: 0,
  savedTenPercent: false,
  notice: 'choose',
  lastSale: null,
});

const chapterNames: Record<LandingLanguage, { title: string; detail: string }[]> = {
  en: [
    { title: 'Set up the table', detail: 'coffee · cake' },
    { title: 'Busy service', detail: 'quick entry' },
    { title: 'See what sells', detail: 'chart from rows' },
    { title: 'Afternoon offer', detail: '10% discount' },
    { title: 'Change the rule', detail: '10% → 20%' },
  ],
  th: [
    { title: 'ตั้งโต๊ะขาย', detail: 'กาแฟ · เค้ก' },
    { title: 'ช่วงงานยุ่ง', detail: 'กดเพิ่มยอด' },
    { title: 'ดูสินค้าขายดี', detail: 'กราฟจากข้อมูล' },
    { title: 'โปรช่วงบ่าย', detail: 'ส่วนลด 10%' },
    { title: 'ปรับกฎเดิม', detail: '10% → 20%' },
  ],
};

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function graphemes(value: string, language: LandingLanguage): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter(language, { granularity: 'grapheme' }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

export function NarrativeSalesDemo({ language }: { language: LandingLanguage }) {
  const [state, setState] = useState<DemoState>(initialState);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const coffeeRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const chapterRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusAfterUpdate = useRef<(() => void) | null>(null);
  const timerRef = useRef<number | null>(null);
  const typeToken = useRef(0);

  const text = (en: string, th: string) => language === 'en' ? en : th;
  const coffeeTotal = state.quantities.coffee * 25;
  const cakeTotal = state.quantities.cake * 50;
  const gross = coffeeTotal + cakeTotal;
  const net = (rate: 10 | 20) => Math.round(gross * (100 - rate)) / 100;
  const pending = (chapter: Chapter) => state.chapter === chapter && (state.phase === 'sent' || state.phase === 'reviewed');
  const tableVisible = state.tableApplied || pending(1);
  const quickPreview = pending(2);
  const chartVisible = state.chartApplied || pending(3);
  const ruleTenVisible = state.discount === 10 || state.savedTenPercent || pending(4);
  const ruleTwentyVisible = state.discount === 20 || pending(5);
  const submitted = state.phase === 'sent' || state.phase === 'reviewed' || state.phase === 'applied';

  useEffect(() => {
    const focus = focusAfterUpdate.current;
    if (!focus) return;
    focusAfterUpdate.current = null;
    focus();
  }, [state.phase, state.maxChapter]);

  useEffect(() => {
    if (state.phase !== 'typing') return;
    const token = ++typeToken.current;
    const prompt = requests[language][state.chapter];
    const characters = graphemes(prompt, language);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setState((current) => current.chapter === state.chapter && current.phase === 'typing'
        ? { ...current, request: prompt, phase: 'ready', notice: 'ready' }
        : current);
      return () => { typeToken.current += 1; };
    }

    let index = 0;
    const typeNext = () => {
      if (token !== typeToken.current) return;
      index += 1;
      setState((current) => current.chapter === state.chapter && current.phase === 'typing'
        ? { ...current, request: characters.slice(0, index).join('') }
        : current);
      if (index >= characters.length) {
        timerRef.current = null;
        setState((current) => current.chapter === state.chapter && current.phase === 'typing'
          ? { ...current, request: prompt, phase: 'ready', notice: 'ready' }
          : current);
      } else {
        timerRef.current = window.setTimeout(typeNext, 28);
      }
    };
    timerRef.current = window.setTimeout(typeNext, 28);

    return () => {
      typeToken.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [language, state.chapter, state.phase]);

  useEffect(() => {
    if (!state.requestIsPreset || state.phase === 'idle' || state.phase === 'typing') return;
    const translatedPrompt = requests[language][state.chapter];
    if (state.request !== translatedPrompt) {
      setState((current) => current.requestIsPreset && current.chapter === state.chapter
        ? { ...current, request: translatedPrompt }
        : current);
    }
  }, [language, state.chapter, state.phase, state.request, state.requestIsPreset]);

  const chooseChapter = (chapter: Chapter) => {
    if (chapter > state.maxChapter) return;
    focusAfterUpdate.current = () => inputRef.current?.focus();
    setState((current) => ({ ...current, chapter, phase: 'typing', request: '', requestIsPreset: true, notice: 'typing' }));
  };

  const sendRequest = () => {
    if (state.phase !== 'ready') return;
    focusAfterUpdate.current = () => reviewRef.current?.focus();
    setState((current) => ({ ...current, phase: 'sent', requestIsPreset: true, notice: 'sent' }));
  };

  const reviewDraft = () => {
    if (state.phase !== 'sent') return;
    focusAfterUpdate.current = () => applyRef.current?.focus();
    setState((current) => ({ ...current, phase: 'reviewed', notice: 'reviewed' }));
  };

  const applyChange = () => {
    if (state.phase !== 'reviewed') return;
    const chapter = state.chapter;
    let focus: (() => void) | null = null;
    if (chapter === 1) focus = () => chapterRefs.current[1]?.focus();
    if (chapter === 2) focus = () => coffeeRef.current?.focus();
    if (chapter === 3) focus = () => chapterRefs.current[3]?.focus();
    if (chapter === 4) focus = () => chapterRefs.current[4]?.focus();
    if (chapter === 5) focus = () => resultRef.current?.focus();
    focusAfterUpdate.current = focus;
    setState((current) => {
      const next: DemoState = { ...current, phase: 'applied' };
      if (chapter === 1) {
        next.tableApplied = true;
        next.maxChapter = Math.max(current.maxChapter, 2) as Chapter;
        next.notice = 'table';
      } else if (chapter === 2) {
        next.quickActionsApplied = true;
        next.maxChapter = Math.max(current.maxChapter, 3) as Chapter;
        next.notice = 'quick';
      } else if (chapter === 3) {
        next.chartApplied = true;
        next.maxChapter = Math.max(current.maxChapter, 4) as Chapter;
        next.notice = 'chart';
      } else if (chapter === 4) {
        next.discount = 10;
        next.savedTenPercent = true;
        next.maxChapter = Math.max(current.maxChapter, 5) as Chapter;
        next.notice = 'discount10';
      } else {
        next.discount = 20;
        next.savedTenPercent = true;
        next.notice = 'discount20';
      }
      return next;
    });
  };

  const addSale = (product: Product) => {
    if (!state.quickActionsApplied) return;
    setState((current) => ({
      ...current,
      quantities: { ...current.quantities, [product]: current.quantities[product] + 1 },
      notice: 'sale',
      lastSale: product,
    }));
  };

  const reset = () => {
    typeToken.current += 1;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    focusAfterUpdate.current = () => chapterRefs.current[0]?.focus();
    setState(initialState());
  };

  const noticeText: Record<Notice, string> = {
    choose: text('Choose the first chapter to begin.', 'เลือกบทแรกเพื่อเริ่มตัวอย่าง'),
    typing: text('A sample request is appearing · you can wait or send it when ready.', 'กำลังแสดงคำขอตัวอย่าง · รอหรือส่งเมื่อพร้อมได้เลย'),
    ready: text('The request is ready · send it when you choose.', 'คำขอพร้อมแล้ว · กดส่งเมื่อคุณต้องการ'),
    sent: text('The request is in this illustration · review the draft before applying it.', 'คำขออยู่ในภาพจำลองนี้ · ตรวจร่างก่อนใช้การเปลี่ยนแปลง'),
    reviewed: text('Draft reviewed · apply the change when ready.', 'ตรวจร่างแล้ว · ใช้การเปลี่ยนแปลงเมื่อพร้อม'),
    table: text(`Sales table applied · coffee 3×25 + cake 3×50 = ${formatAmount(gross)}.`, `วางโต๊ะขายแล้ว · กาแฟ 3×25 + เค้ก 3×50 = ${formatAmount(gross)}`),
    quick: text('Quick-sale buttons applied · try Coffee or Cake to add one.', 'เพิ่มปุ่มขายแล้ว · ลองกดกาแฟหรือเค้กเพื่อเพิ่มจำนวน'),
    chart: text('Chart applied · it reads the same sales rows.', 'เพิ่มกราฟแล้ว · กราฟอ่านจากรายการขายชุดเดียวกัน'),
    discount10: text(`10% discount applied · gross ${formatAmount(gross)} · net ${formatAmount(net(10))}.`, `ใช้ส่วนลด 10% แล้ว · ยอดก่อนลด ${formatAmount(gross)} · ยอดสุทธิ ${formatAmount(net(10))}`),
    discount20: text(`20% discount applied · gross ${formatAmount(gross)} · net ${formatAmount(net(20))} · the previous 10% rule is retained.`, `ใช้ส่วนลด 20% แล้ว · ยอดก่อนลด ${formatAmount(gross)} · ยอดสุทธิ ${formatAmount(net(20))} · เก็บกฎ 10% เดิมไว้`),
    sale: text(`${state.lastSale === 'coffee' ? 'Coffee' : 'Cake'} +1 · gross ${formatAmount(gross)}${state.discount ? ` · net ${formatAmount(net(state.discount))}` : ''}.`, `${state.lastSale === 'coffee' ? 'กาแฟ' : 'เค้ก'} +1 · ยอดก่อนลด ${formatAmount(gross)}${state.discount ? ` · ยอดสุทธิ ${formatAmount(net(state.discount))}` : ''}`),
  };

  const currentNet = state.discount ? formatAmount(net(state.discount)) : text('not calculated', 'ยังไม่คำนวณ');
  const currentNetSummary = state.discount
    ? text(`Currently ${state.discount}% · net ${currentNet}`, `ขณะนี้ใช้ ${state.discount}% · ยอดสุทธิ ${currentNet}`)
    : text('No discount is active yet.', 'ยังไม่มีส่วนลดที่ใช้');
  const chartMax = Math.max(coffeeTotal, cakeTotal, 1);
  const percentage = (value: number) => `${Math.max(2, value / chartMax * 100)}%`;

  return <section className="tt-sales-demo" id="board" aria-labelledby="tt-sales-demo-title">
    <div className="tt-sales-demo__intro">
      <div>
        <p className="tt-sales-demo__kicker">{text('EXAMPLE TABLE · SMALL CAFÉ', 'โต๊ะตัวอย่าง · ร้านกาแฟ')}</p>
        <h2 id="tt-sales-demo-title">{text('Start with sales. Build on the same table.', 'เริ่มจากจดขาย แล้วค่อยต่อยอด')}</h2>
      </div>
      <span className="tt-sales-demo__sample">{text('Illustrative · sample data', 'ภาพอธิบาย · ข้อมูลตัวอย่าง')}</span>
    </div>

    <div className="tt-sales-demo__canvas" data-chapter={state.chapter}>
      <div className="tt-sales-demo__canvas-head">
        <div className="tt-sales-demo__canvas-name"><span className="tt-sales-demo__canvas-mark" aria-hidden="true"><i /><i /><i /><i /></span>{text('Today’s sales', 'ยอดขายวันนี้')}</div>
        <span className="tt-sales-demo__canvas-state"><span aria-hidden="true" />{state.tableApplied ? text('On canvas', 'อยู่บนโต๊ะ') : tableVisible ? text('Draft · review', 'ร่าง · รอตรวจ') : text('Ready to begin', 'พร้อมเริ่ม')}</span>
      </div>

      <div className="tt-sales-demo__request-area">
        <div className="tt-sales-demo__request-heading">
          <div>
            <p>{text('SAMPLE REQUEST', 'คำขอตัวอย่าง')}</p>
            <span>{text('Choose a chapter, then send the sample request yourself.', 'เลือกบท แล้วส่งคำขอตัวอย่างด้วยตัวเอง')}</span>
          </div>
          <span className="tt-sales-demo__local-label">{text('LOCAL ILLUSTRATION', 'ภาพจำลอง')}</span>
        </div>
        <label htmlFor="tt-sales-request" className="tt-sales-demo__visually-hidden">{text('Read-only sample request', 'ข้อความคำขอตัวอย่างแบบอ่านอย่างเดียว')}</label>
        <textarea
          ref={inputRef}
          id="tt-sales-request"
          rows={2}
          readOnly
          disabled={state.phase === 'idle'}
          value={state.request}
          aria-describedby="tt-sales-request-note"
        />
        <div className="tt-sales-demo__request-foot">
          <p id="tt-sales-request-note">{text('The selected chapter controls the illustration · text is not interpreted.', 'บทที่เลือกกำหนดภาพจำลอง · ข้อความไม่ได้ถูกประมวลผล')}</p>
          <button className="tt-sales-demo__send" ref={sendRef} type="button" onClick={sendRequest} disabled={state.phase !== 'ready'}>
            <Send size={15} aria-hidden="true" />{text('Send sample request', 'ส่งคำขอตัวอย่าง')}
          </button>
        </div>
      </div>

      <div className="tt-sales-demo__flow">
        <article className="tt-sales-demo__node tt-sales-demo__brief" aria-labelledby="tt-sales-brief-title">
          <p className="tt-sales-demo__node-label" id="tt-sales-brief-title">{text('THE BRIEF', 'โจทย์')}</p>
          <blockquote aria-live="polite">{submitted ? `“${state.request}”` : text('The sent request will appear here.', 'คำขอที่ส่งจะแสดงตรงนี้')}</blockquote>
          <p className="tt-sales-demo__node-note">{text('Start with the work.', 'เริ่มจากเรื่องที่อยากทำ')}</p>
        </article>
        <div className="tt-sales-demo__connector" aria-hidden="true"><ArrowRight /><ArrowDown /></div>

        <div className="tt-sales-demo__table-slot">
          {!tableVisible ? <article className="tt-sales-demo__node tt-sales-demo__empty">
            <p className="tt-sales-demo__node-label">{text('ON THE TABLE', 'ข้อมูลบนโต๊ะ')}</p>
            <div className="tt-sales-demo__empty-mark" aria-hidden="true"><span /><span /><span /></div>
            <h3>{text('Start with a prompt', 'เริ่มจากโจทย์')}</h3>
            <p>{text('Send the first sample request to place the sales table here.', 'ส่งคำขอตัวอย่างแรกเพื่อวางรายการขายลงบนโต๊ะ')}</p>
          </article> : <article className="tt-sales-demo__node tt-sales-demo__table">
            <div className="tt-sales-demo__node-head">
              <div><p className="tt-sales-demo__node-label">{text('SALES RECORDS', 'รายการขาย')}</p><h3>{text('Today’s sales', 'ยอดขายวันนี้')}</h3></div>
              <span className={state.tableApplied ? '' : 'is-draft'}>{state.tableApplied ? text('On canvas', 'อยู่บนโต๊ะ') : text('Draft · review', 'ร่าง · รอตรวจ')}</span>
            </div>
            <div className="tt-sales-demo__table-scroll">
              <table>
                <caption>{text('Sample café sales records', 'รายการตัวอย่างจากร้านกาแฟ')}</caption>
                <thead><tr><th scope="col">{text('Item', 'รายการ')}</th><th scope="col">{text('Qty', 'จำนวน')}</th><th scope="col">{text('Price', 'ราคา')}</th><th scope="col">{text('Total', 'รวม')}</th></tr></thead>
                <tbody>
                  <tr><th scope="row">{text('Coffee', 'กาแฟ')}</th><td>{state.quantities.coffee}</td><td>25</td><td>{formatAmount(coffeeTotal)}</td></tr>
                  <tr><th scope="row">{text('Cake', 'เค้ก')}</th><td>{state.quantities.cake}</td><td>50</td><td>{formatAmount(cakeTotal)}</td></tr>
                </tbody>
                <tfoot><tr><th colSpan={3} scope="row">{text('Gross total', 'ยอดก่อนลด')}</th><td>{formatAmount(gross)}</td></tr></tfoot>
              </table>
            </div>
            {(state.quickActionsApplied || quickPreview) && <div className="tt-sales-demo__quick-actions">
              <p>{text('Quick-add during service', 'เพิ่มยอดขายขณะให้บริการ')}</p>
              <div>
                <button ref={coffeeRef} type="button" onClick={() => addSale('coffee')} disabled={!state.quickActionsApplied} aria-label={text('Add one coffee', 'เพิ่มกาแฟ 1 แก้ว')}><span aria-hidden="true">+</span>{text('Coffee +1', 'กาแฟ +1')}</button>
                <button type="button" onClick={() => addSale('cake')} disabled={!state.quickActionsApplied} aria-label={text('Add one cake', 'เพิ่มเค้ก 1 ชิ้น')}><span aria-hidden="true">+</span>{text('Cake +1', 'เค้ก +1')}</button>
              </div>
            </div>}
          </article>}
        </div>

        <div className="tt-sales-demo__connector" aria-hidden="true"><ArrowRight /><ArrowDown /></div>
        <div className="tt-sales-demo__summary-lane">
          <article className="tt-sales-demo__node tt-sales-demo__result" aria-labelledby="tt-sales-result-title">
            <p className="tt-sales-demo__node-label">{text('RESULT', 'ผลลัพธ์')}</p>
            <h3 id="tt-sales-result-title" ref={resultRef} tabIndex={-1}>{text('Today’s total', 'สรุปวันนี้')}</h3>
            <dl>
              <div><dt>{text('Gross', 'ยอดก่อนลด')}</dt><dd>{tableVisible ? formatAmount(gross) : text('no data', 'ยังไม่มีข้อมูล')}</dd></div>
              <div><dt>{text('Discount', 'ส่วนลด')}</dt><dd>{state.discount ? `${state.discount}%` : text('none', 'ยังไม่ใช้')}</dd></div>
              <div className="is-net"><dt>{text('Net', 'ยอดสุทธิ')}</dt><dd>{state.discount ? currentNet : text('not calculated', 'ยังไม่คำนวณ')}</dd></div>
            </dl>
            <p className="tt-sales-demo__result-note" aria-live="polite">
              {state.discount
                ? text(`${state.discount}% applied · gross ${formatAmount(gross)} · net ${currentNet}${state.discount === 20 && state.savedTenPercent ? ' · previous 10% rule retained' : ''}.`, `ใช้ ${state.discount}% · ยอดก่อนลด ${formatAmount(gross)} · ยอดสุทธิ ${currentNet}${state.discount === 20 && state.savedTenPercent ? ' · เก็บกฎ 10% เดิมไว้' : ''}`)
                : pending(4)
                  ? text(`The 10% draft is not active · gross ${formatAmount(gross)}.`, `ร่าง 10% ยังไม่ทำงาน · ยอดก่อนลด ${formatAmount(gross)}`)
                  : pending(5)
                    ? text(`10% remains active · gross ${formatAmount(gross)} · net ${formatAmount(net(10))}.`, `10% ยังทำงานอยู่ · ยอดก่อนลด ${formatAmount(gross)} · ยอดสุทธิ ${formatAmount(net(10))}`)
                    : tableVisible
                      ? text(`Gross is calculated from the sales rows · ${formatAmount(gross)}.`, `ยอดก่อนลดคำนวณจากรายการบนโต๊ะ · ${formatAmount(gross)}`)
                      : text('No calculation on the table yet.', 'ยังไม่มีวิธีคำนวณบนโต๊ะ')}
            </p>
          </article>

          <div className="tt-sales-demo__branches">
            {chartVisible && <article className="tt-sales-demo__node tt-sales-demo__chart">
              <p className="tt-sales-demo__node-label">{text('FROM THE SAME ROWS', 'จากรายการเดียวกัน')}</p>
              <h3>{text('Sales by item', 'ยอดขายแยกตามสินค้า')}</h3>
              <div role="group" aria-label={text('Sales by item chart', 'กราฟยอดขายแยกตามสินค้า')}>
                <div className="tt-sales-demo__chart-row"><span>{text('Coffee', 'กาแฟ')}</span><span className="tt-sales-demo__bar"><i style={{ width: percentage(coffeeTotal) }} /></span><strong>{formatAmount(coffeeTotal)}</strong></div>
                <div className="tt-sales-demo__chart-row"><span>{text('Cake', 'เค้ก')}</span><span className="tt-sales-demo__bar"><i style={{ width: percentage(cakeTotal) }} /></span><strong>{formatAmount(cakeTotal)}</strong></div>
              </div>
              <p>{text('Updates with the table quantities.', 'อัปเดตตามจำนวนบนโต๊ะ')}</p>
            </article>}
            {ruleTenVisible && <article className={`tt-sales-demo__node tt-sales-demo__rule${state.discount === 10 ? ' is-applied' : pending(4) ? ' is-draft' : ''}`}>
              <div className="tt-sales-demo__rule-head"><div><p className="tt-sales-demo__node-label">{text('CALCULATION', 'วิธีคำนวณ')}</p><h3>{text('10% discount', 'ส่วนลด 10%')}</h3></div><span>{state.discount === 10 ? text('Applied · active', 'ใช้แล้ว · ทำงาน') : state.savedTenPercent ? text('Saved · previous rule', 'เก็บไว้ · กฎเดิม') : pending(4) ? state.phase === 'reviewed' ? text('Reviewed · draft', 'ตรวจแล้ว · ร่าง') : text('Draft · review', 'ร่าง · รอตรวจ') : ''}</span></div>
              <code>net = gross × 0.90</code><p>{text('Gross sales × 90%', 'ยอดขายรวม × 90%')}</p>
            </article>}
            {ruleTwentyVisible && <article className={`tt-sales-demo__node tt-sales-demo__rule is-new${state.discount === 20 ? ' is-applied' : pending(5) ? ' is-draft' : ''}`}>
              <div className="tt-sales-demo__rule-head"><div><p className="tt-sales-demo__node-label">{text('PROPOSED CHANGE', 'กฎที่เสนอใหม่')}</p><h3>{text('20% discount', 'ส่วนลด 20%')}</h3></div><span>{state.discount === 20 ? text('Applied · active', 'ใช้แล้ว · ทำงาน') : pending(5) ? state.phase === 'reviewed' ? text('Reviewed · pending', 'ตรวจแล้ว · รอใช้') : text('Draft · review', 'ร่าง · รอตรวจ') : ''}</span></div>
              <code>net = gross × 0.80</code><p>{text('Change this rule only', 'เปลี่ยนส่วนลดเฉพาะจุด')}</p>
            </article>}
          </div>
        </div>
      </div>

      <p className="tt-sales-demo__status" role="status" aria-live="polite">{noticeText[state.notice]}</p>
      {state.phase === 'sent' || state.phase === 'reviewed' ? <p className="tt-sales-demo__draft-summary" aria-live="polite">
        {state.chapter === 1 && text(`Draft table · 2 items · gross ${formatAmount(gross)} · review then apply to place it on the canvas.`, `ร่างโต๊ะ 2 รายการ · ยอดก่อนลด ${formatAmount(gross)} · ตรวจแล้วกดใช้เพื่อวางลงบนโต๊ะ`)}
        {state.chapter === 2 && text(`Draft quick-add actions · coffee ${state.quantities.coffee} · cake ${state.quantities.cake} · gross ${formatAmount(gross)}.`, `ร่างปุ่มเพิ่มจำนวน · กาแฟ ${state.quantities.coffee} แก้ว · เค้ก ${state.quantities.cake} ชิ้น · ยอดก่อนลด ${formatAmount(gross)}`)}
        {state.chapter === 3 && text(`Draft chart from the same rows · coffee ${formatAmount(coffeeTotal)} · cake ${formatAmount(cakeTotal)}.`, `ร่างกราฟจากรายการเดิม · กาแฟ ${formatAmount(coffeeTotal)} · เค้ก ${formatAmount(cakeTotal)}`)}
        {state.chapter === 4 && text(`Draft 10% discount · gross remains ${formatAmount(gross)} · net after applying ${formatAmount(net(10))} · ${currentNetSummary}.`, `ร่างส่วนลด 10% · ยอดก่อนลดยังคง ${formatAmount(gross)} · ยอดสุทธิหลังใช้ ${formatAmount(net(10))} · ${currentNetSummary}`)}
        {state.chapter === 5 && text(`Draft change to 20% · gross remains ${formatAmount(gross)} · ${currentNetSummary} · net after applying ${formatAmount(net(20))}.`, `ร่างเปลี่ยนเป็น 20% · ยอดก่อนลดยังคง ${formatAmount(gross)} · ${currentNetSummary} · หลังใช้กฎใหม่ยอดสุทธิ ${formatAmount(net(20))}`)}
      </p> : null}

      <div className="tt-sales-demo__controls">
        <div className="tt-sales-demo__chapters" role="group" aria-label={text('Five example chapters', 'ตัวอย่าง 5 ช่วง')}>
          {chapterNames[language].map((chapter, index) => {
            const number = (index + 1) as Chapter;
            return <button
              ref={(element) => { chapterRefs.current[index] = element; }}
              className={state.chapter === number ? 'is-current' : ''}
              type="button"
              key={number}
              onClick={() => chooseChapter(number)}
              disabled={number > state.maxChapter}
              aria-current={state.chapter === number ? 'step' : undefined}
            ><span className="tt-sales-demo__chapter-number">{String(number).padStart(2, '0')}</span><span className="tt-sales-demo__chapter-copy"><strong>{chapter.title}</strong><small>{chapter.detail}</small></span></button>;
          })}
        </div>
        <div className="tt-sales-demo__actions">
          {state.phase === 'sent' && <button className="tt-sales-demo__review" ref={reviewRef} type="button" onClick={reviewDraft}>{text('Review draft', 'ตรวจร่าง')} <ArrowRight size={15} aria-hidden="true" /></button>}
          {state.phase === 'reviewed' && <button className="tt-sales-demo__apply" ref={applyRef} type="button" onClick={applyChange}><Check size={16} aria-hidden="true" />{text('Apply change', 'ใช้การเปลี่ยนแปลง')}</button>}
          <button className="tt-sales-demo__reset" type="button" onClick={reset}><RotateCcw size={14} aria-hidden="true" />{text('Reset example', 'เริ่มตัวอย่างใหม่')}</button>
        </div>
      </div>
    </div>
    <p className="tt-sales-demo__disclosure">{text('This browser-only illustration calculates sample data. It does not call AI or save to Tabletop.', 'กระดานนี้คำนวณจากข้อมูลตัวอย่างในเบราว์เซอร์ ไม่เรียก AI และไม่บันทึกเข้าระบบ')}</p>
  </section>;
}
