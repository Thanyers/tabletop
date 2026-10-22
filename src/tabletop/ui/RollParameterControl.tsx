import { useId } from 'react';
import type { WorkspaceView } from '../shared/contracts';
import { rollNotation } from '../shared/roll';
import type { TableParameter } from '../shared/table-contracts';
import { useServerRoll } from './roll-store';
import './roll-control.css';

/**
 * F048: the control bound to a `roll` action parameter. The value comes from `table.roll` and stays
 * read-only until a re-roll; the action submission never carries it.
 */
export function RollParameterControl({ id, view, actionId, parameter, disabled, onRoll }: {
  id?: string;
  view: WorkspaceView;
  actionId: string;
  parameter: TableParameter;
  disabled: boolean;
  onRoll: () => void;
}) {
  const generatedId = useId().replace(/:/g, '');
  const controlId = id ?? `tt-roll-${generatedId}`;
  const resultId = `${controlId}-result`;
  const roll = useServerRoll(view, actionId, parameter.id);
  const notation = parameter.roll ? rollNotation(parameter.roll) : '1d6';
  return <section className="tt-table-roll" aria-label={parameter.label}>
    <header className="tt-table-roll__header">
      <span className="tt-table-roll__label" id={`${controlId}-label`}>{parameter.label}</span>
      <small className="tt-table-roll__notation">{notation} · server roll</small>
    </header>
    <div className="tt-table-roll__body">
      <button type="button" id={controlId} className="tt-button tt-button--primary tt-table-roll__button" disabled={disabled}
        aria-describedby={roll ? `${resultId} ${controlId}-locked` : `${controlId}-hint`} onClick={onRoll}>
        {roll ? 'ทอยอีกครั้ง' : 'ทอย'}
      </button>
      {roll
        ? <div className="tt-table-roll__result" id={resultId} aria-live="polite">
          <span className="tt-table-roll__dice" aria-label={`ผลทอย ${roll.values.length} ลูก`}>
            {roll.values.map((value, index) => <span className="tt-table-roll__die" key={`${index}-${value}`}>{value}</span>)}
          </span>
          <output className="tt-table-roll__total" aria-label={`รวม ${roll.total}`}>= {roll.total}</output>
          <small className="tt-table-roll__locked" id={`${controlId}-locked`}>ค่าถูกล็อกไว้จนกว่าจะกด “ทอยอีกครั้ง”</small>
        </div>
        : <p className="tt-table-roll__hint" id={`${controlId}-hint`}>กด “ทอย” เพื่อให้ server ทอย {notation} แล้วค่าจะถูกล็อกไว้</p>}
    </div>
  </section>;
}
