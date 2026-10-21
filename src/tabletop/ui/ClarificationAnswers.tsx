import { useId, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { MAX_WRITTEN_ANSWER_CHARS, composeClarificationAnswer } from './clarification-answer';

/** F020: pick one or more of the AI's answers and/or write your own, then send once. */
export function ClarificationAnswers({ options, disabled, onAnswer }: { options: readonly string[]; disabled: boolean; onAnswer: (answer: string) => void }) {
  const id = useId().replaceAll(':', '');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [writeOwn, setWriteOwn] = useState(false);
  const [written, setWritten] = useState('');
  const answer = composeClarificationAnswer(options, selected, writeOwn ? written : '');
  const toggle = (option: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(option)) next.delete(option); else next.add(option);
    return next;
  });

  return <form className="tt-chat-card__answers" onSubmit={(event) => { event.preventDefault(); if (answer && !disabled) onAnswer(answer); }}>
    <ul className="tt-chat-card__questions" aria-label="Answer choices">
      {options.map((option, index) => <li key={option}>
        <label className="tt-chat-card__choice" htmlFor={`${id}-choice-${index}`}>
          <input id={`${id}-choice-${index}`} type="checkbox" checked={selected.has(option)} disabled={disabled} onChange={() => toggle(option)} />
          <span>{option}</span>
        </label>
      </li>)}
      <li>
        <label className="tt-chat-card__choice" htmlFor={`${id}-own`}>
          <input id={`${id}-own`} type="checkbox" checked={writeOwn} disabled={disabled} onChange={(event) => setWriteOwn(event.target.checked)} />
          <span>Write my own answer</span>
        </label>
        {writeOwn && <input className="tt-chat-card__own-answer" type="text" aria-label="Your answer" value={written} maxLength={MAX_WRITTEN_ANSWER_CHARS} disabled={disabled} autoFocus
          onChange={(event) => setWritten(event.target.value)} />}
      </li>
    </ul>
    <button type="submit" className="tt-button tt-button--primary tt-chat-card__send-answer" disabled={disabled || !answer}>Send answer<ArrowRight size={14} aria-hidden="true" /></button>
  </form>;
}
