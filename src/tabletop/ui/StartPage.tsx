import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle, Plus, Sparkles } from 'lucide-react';
import { STARTERS, type StarterKind } from '../shared/starters';
import './start-page.css';

const DESCRIPTION_LIMIT = 1200;

interface StartPageProps {
  header: ReactNode;
  notice: ReactNode;
  busy: boolean;
  tableReadOnly: boolean;
  renderIcon: (kind: StarterKind) => ReactNode;
  onChooseStarter: (kind: StarterKind) => void;
  onDescribe: (description: string) => void;
  onStartEmpty: () => void;
  onBack: () => void;
}

export function StartPage({ header, notice, busy, tableReadOnly, renderIcon, onChooseStarter, onDescribe, onStartEmpty, onBack }: StartPageProps) {
  const [description, setDescription] = useState('');
  const trimmed = description.trim();

  return <main className="tt-chooser tt-start-page" data-testid="start-page">
    {header}
    {notice}
    <section className="tt-start-page__content" aria-labelledby="tt-start-page-title">
      <button type="button" className="tt-start-page__back" onClick={onBack}><ArrowLeft size={15} />Your tables</button>
      <h1 id="tt-start-page-title">What should we start with?</h1>
      <p>Open a prepared table to see how it works, or describe what you want to make.</p>

      <div className="tt-start-page__cards" role="list" aria-label="Ways to start">
        {STARTERS.map((starter) => <div role="listitem" key={starter.id}>
          <button type="button" className="tt-start-card" disabled={busy} onClick={() => onChooseStarter(starter.kind)}>
            <span className="tt-start-card__icon" aria-hidden="true">{renderIcon(starter.kind)}</span>
            <strong>{starter.title}</strong>
            <small>{starter.summary}</small>
            <span className="tt-start-card__go" aria-hidden="true"><ArrowRight size={15} /></span>
          </button>
        </div>)}
        <div role="listitem">
          <button type="button" className="tt-start-card tt-start-card--empty" aria-label="Start empty with your own files" disabled={busy || tableReadOnly} onClick={onStartEmpty}>
            <span className="tt-start-card__icon" aria-hidden="true"><Plus size={18} /></span>
            <strong>Start empty</strong>
            <small>A blank shared table. Add your own files, then describe what you need.</small>
            <span className="tt-start-card__go" aria-hidden="true"><ArrowRight size={15} /></span>
          </button>
        </div>
      </div>

      <form className="tt-start-page__describe" onSubmit={(event) => { event.preventDefault(); if (trimmed && !busy && !tableReadOnly) onDescribe(trimmed); }}>
        <label htmlFor="tt-start-description"><Sparkles size={14} aria-hidden="true" />Or describe what you want to make</label>
        <textarea id="tt-start-description" value={description} maxLength={DESCRIPTION_LIMIT} rows={3} disabled={tableReadOnly}
          placeholder="For example: track who borrows the team's cameras and when they bring them back."
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit(); }} />
        <div className="tt-start-page__describe-foot">
          <small>Creates an empty shared table and keeps this description for drafting its rules. Add a file if useful; nothing is sent to AI until you agree.</small>
          <button type="submit" className="tt-button tt-button--primary" disabled={!trimmed || busy || tableReadOnly}>{busy ? <LoaderCircle size={15} className="tt-spin" /> : <ArrowRight size={15} />}Start with this</button>
        </div>
      </form>

      {tableReadOnly && <p role="status">New shared tables are temporarily paused. You can still open a prepared table or an existing one.</p>}
    </section>
  </main>;
}
