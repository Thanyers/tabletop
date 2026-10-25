import type { ComponentType, CSSProperties } from 'react';
import type { PresentationId, RenderedComponentDefinition, SurfaceRecord, SurfaceRendererProps, SurfaceResolution } from './types';

function formatValue(record: SurfaceRecord, columnId: string): string {
  return record.fields[columnId]?.text ?? '—';
}

function LoadingNotice() {
  return <div className="trio-adaptive-surface__state" role="status"><span className="trio-adaptive-surface__state-mark" aria-hidden="true">···</span><span><strong>กำลังเตรียมมุมมอง</strong><small>กำลังอ่านกติกาที่ใช้อยู่</small></span></div>;
}

function EmptyNotice() {
  return <div className="trio-adaptive-surface__state" role="status"><span className="trio-adaptive-surface__state-mark" aria-hidden="true">—</span><span><strong>ยังไม่มีรายการให้แสดง</strong><small>เพิ่มข้อมูลในเรื่องนี้แล้วลองดูอีกครั้ง</small></span></div>;
}

function ErrorNotice({ message }: { message?: string }) {
  return <div className="trio-adaptive-surface__state is-error" role="alert"><span className="trio-adaptive-surface__state-mark" aria-hidden="true">!</span><span><strong>ตรวจข้อมูลกติกา</strong><small>{message ?? 'กติกาที่ใช้อยู่สร้างมุมมองนี้ไม่ได้'}</small></span></div>;
}

export function TableView({ surface, compact = false }: SurfaceRendererProps) {
  if (surface.state === 'loading') return <LoadingNotice />;
  if (surface.state === 'empty' || surface.records.length === 0) return <EmptyNotice />;
  return (
    <div className={`trio-adaptive-surface__table-wrap${compact ? ' is-compact' : ''}`}>
      {surface.state === 'error' && <ErrorNotice message={surface.stateMessage} />}
      <div className="trio-adaptive-surface__table-scroll" role="region" aria-label={`ตาราง${surface.title}`} tabIndex={0}>
        <table className="trio-adaptive-surface__table">
          <caption>{surface.title} · ใช้กติกาที่ใช้อยู่ V{surface.activeVersion}</caption>
          <thead><tr>
            <th scope="col">รายการ</th>
            {surface.columns.map((column) => <th scope="col" key={column.id}>{column.label}</th>)}
          </tr></thead>
          <tbody>
            {surface.records.map((record) => <tr key={record.id} data-narrative-record={record.id === 'first-hint' ? 'library' : record.id}>
              <th scope="row"><strong>{record.label}</strong>{record.detail && <small>{record.detail}</small>}</th>
              {surface.columns.map((column) => {
                const cell = record.fields[column.id];
                return <td key={column.id} data-narrative-field={column.id} data-tone={cell?.tone ?? 'normal'}>{cell?.text ?? '—'}</td>;
              })}
            </tr>)}
          </tbody>
        </table>
      </div>
      {!compact && <p className="trio-adaptive-surface__table-foot">{surface.records.length} รายการ · {surface.derivedLabel}</p>}
    </div>
  );
}

export function MetricCards({ surface, compact = false }: SurfaceRendererProps) {
  if (surface.state === 'loading') return <LoadingNotice />;
  if (surface.state === 'empty' || surface.records.length === 0) return <EmptyNotice />;
  return (
    <div className={`trio-adaptive-surface__cards-wrap${compact ? ' is-compact' : ''}`}>
      {surface.state === 'error' && <ErrorNotice message={surface.stateMessage} />}
      <div className="trio-adaptive-surface__cards" role="list" aria-label={`${surface.title} · ${surface.records.length} รายการ`}>
        {surface.records.map((record) => <article className="trio-adaptive-surface__data-card" role="listitem" key={record.id} data-narrative-record={record.id === 'first-hint' ? 'library' : record.id}>
          <header><span><strong>{record.label}</strong>{record.detail && <small>{record.detail}</small>}</span>{record.status && <span className="trio-adaptive-surface__status" data-tone={record.statusTone ?? 'normal'}>{record.status}</span>}</header>
          <strong className="trio-adaptive-surface__measure" data-narrative-field={surface.caseId === 'shipping' ? 'amount' : 'tempo'}>{record.measureText}</strong>
          <dl>{surface.columns.filter((column) => column.id !== 'result').map((column) => <div key={column.id}>
            <dt>{column.label}</dt><dd data-tone={record.fields[column.id]?.tone ?? 'normal'}>{formatValue(record, column.id)}</dd>
          </div>)}</dl>
        </article>)}
      </div>
    </div>
  );
}

export function BarChart({ surface, compact = false }: SurfaceRendererProps) {
  if (surface.state === 'loading') return <LoadingNotice />;
  if (surface.state === 'empty' || surface.records.length === 0) return <EmptyNotice />;
  const values = surface.records.map((record) => record.measure).filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  const max = Math.max(...values, 1);
  const pendingCount = surface.records.length - values.length;
  return (
    <div className={`trio-adaptive-surface__chart-wrap${compact ? ' is-compact' : ''}`}>
      {surface.state === 'error' && <ErrorNotice message={surface.stateMessage} />}
      <div className="trio-adaptive-surface__chart" role="img" aria-label={`${surface.title}. ${surface.records.map((record) => `${record.label}: ${record.measureText}`).join('; ')}`}>
        {surface.records.map((record) => {
          const value = record.measure;
          const width = value === null || !Number.isFinite(value) ? 0 : Math.max(value > 0 ? 3 : 0, Math.min(100, (value / max) * 100));
          return <div className="trio-adaptive-surface__bar-row" key={record.id} data-narrative-record={record.id === 'first-hint' ? 'library' : record.id}>
            <span className="trio-adaptive-surface__bar-label">{record.label}</span>
            <span className="trio-adaptive-surface__bar-track" aria-hidden="true">
              {value === null ? <i className="is-pending" /> : <i style={{ '--trio-bar-width': `${width}%` } as CSSProperties} />}
            </span>
            <strong data-narrative-field={surface.caseId === 'shipping' ? 'amount' : 'tempo'}>{record.measureText}</strong>
          </div>;
        })}
      </div>
      <div className="trio-adaptive-surface__chart-caption"><span>{surface.records.length - pendingCount} ค่าที่แสดง</span>{pendingCount > 0 && <span>{pendingCount} รายการรอตรวจ</span>}</div>
    </div>
  );
}

export const STANDARD_RENDERERS = {
  table: TableView,
  cards: MetricCards,
  chart: BarChart,
} satisfies Record<Exclude<PresentationId, 'original'>, ComponentType<SurfaceRendererProps>>;

export const STANDARD_COMPONENTS = {
  form: { kind: 'form', label: 'เครื่องมือเดิม', description: 'รักษาฟอร์มและการทำงานของการ์ดต้นฉบับไว้', source: 'preserved-child' },
  table: { kind: 'table', label: 'ตาราง', description: 'เปรียบเทียบค่าหลายรายการในแถวเดียว', component: TableView },
  cards: { kind: 'cards', label: 'การ์ด', description: 'อ่านค่าหลักแยกเป็นรายการ', component: MetricCards },
  chart: { kind: 'chart', label: 'กราฟแท่ง', description: 'เห็นความต่างของค่าตัวเลข', component: BarChart },
} satisfies Record<'form', { kind: 'form'; label: string; description: string; source: 'preserved-child' }>
  & Record<Exclude<PresentationId, 'original'>, RenderedComponentDefinition>;

function PreviewCells({ surface }: { surface: SurfaceResolution }) {
  const columns = surface.columns.slice(0, 3);
  return <div className="trio-adaptive-surface__preview-table">
    <div className="is-head"><span>รายการ</span>{columns.map((column) => <span key={column.id}>{column.label}</span>)}</div>
    {surface.records.slice(0, 2).map((record) => <div key={record.id}>
      <strong>{record.label}</strong>{columns.map((column) => <span key={column.id}>{record.fields[column.id]?.text ?? '—'}</span>)}
    </div>)}
  </div>;
}

function PreviewCards({ surface }: { surface: SurfaceResolution }) {
  return <div className="trio-adaptive-surface__preview-cards">
    {surface.records.slice(0, 2).map((record) => <span key={record.id}>
      <strong>{record.label}</strong><b>{record.measureText}</b><small>{record.status ?? record.detail}</small>
    </span>)}
  </div>;
}

function PreviewChart({ surface }: { surface: SurfaceResolution }) {
  const values = surface.records.map((record) => record.measure).filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  const max = Math.max(...values, 1);
  return <div className="trio-adaptive-surface__preview-chart" aria-hidden="true">
    {surface.records.slice(0, 4).map((record) => <span key={record.id}>
      <i style={{ '--trio-bar-width': `${record.measure === null ? 0 : Math.max(4, (record.measure / max) * 100)}%` } as CSSProperties} />
    </span>)}
  </div>;
}

function PreviewOriginal({ surface }: { surface: SurfaceResolution }) {
  if (surface.caseId === 'quest') {
    return <div className="trio-adaptive-surface__preview-route" aria-hidden="true">
      <i />
      {surface.records.slice(0, 3).map((record) => <span key={record.id}><b>{record.fields.hints?.text ?? '•'}</b><small>{record.label}</small></span>)}
      <i />
    </div>;
  }
  if (surface.caseId === 'music') {
    return <div className="trio-adaptive-surface__preview-sections" aria-hidden="true">
      {surface.records.slice(0, 5).map((record) => <span key={record.id} data-tone={record.statusTone}>
        <i style={{ '--trio-bar-width': `${record.fields.beats?.numericValue ? Math.max(12, Number(record.fields.beats.numericValue) * 4) : 12}px` } as CSSProperties} />
        <small>{record.id.slice(-1)}</small>
      </span>)}
      <strong>เมโทรนอม</strong>
    </div>;
  }
  return <PreviewCells surface={surface} />;
}

export function PresentationPreview({ surface, presentation }: { surface: SurfaceResolution; presentation: PresentationId }) {
  return <div className={`trio-adaptive-surface__preview trio-adaptive-surface__preview--${presentation}`}>
    {presentation === 'original' ? <PreviewOriginal surface={surface} />
      : presentation === 'table' ? <PreviewCells surface={surface} />
        : presentation === 'cards' ? <PreviewCards surface={surface} />
          : <PreviewChart surface={surface} />}
  </div>;
}

