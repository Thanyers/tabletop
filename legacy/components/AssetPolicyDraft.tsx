import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  Database,
  Eye,
  FileSearch,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { reconcile } from '../domain/accounting';
import type { Asset, Category, CategoryPolicyRule, Policy } from '../domain/types';
import { resolveCategoryPolicy, withCategoryPolicy } from '../domain/policy';
import { TEACHING_PROMPT, useWorkspace } from '../state/store';
import type { DemoDraftStage, Workspace } from '../state/types';
import './asset-policy-draft.css';
import './adaptive-ui.css';

type RuleCategory = 'Furniture' | 'Equipment' | 'Vehicle';
type DraftCategory = Category;
type CategoryFilter = 'All' | DraftCategory;
type View = 'settings' | 'assets';
type CategoryText = Partial<Record<DraftCategory, string>>;

interface AssetPolicyDraftProps {
  workspace: Workspace;
  initialInstruction?: string;
  propose: (candidate: Policy, instruction: string) => void;
  onPreviewList?: () => void;
}

const CATEGORIES: DraftCategory[] = ['Laptop', 'Furniture', 'Equipment', 'Vehicle', 'Unknown'];
const STAGE_TITLE: Record<Exclude<DemoDraftStage, null>, string> = {
  threshold: 'Choose the Laptop threshold',
  'threshold-set': 'Laptop threshold added',
  schedule: 'Add the useful-life field',
  'life-set': 'Useful life set · 36 months',
  start: 'Add the start convention',
  'schedule-set': 'Start convention set',
  categories: 'Set rules by asset type',
  preview: 'Preview the candidate list',
  browse: 'Browse source evidence',
};
const STAGE_ADDED: Partial<Record<Exclude<DemoDraftStage, null>, string>> = {
  'threshold-set': 'ตั้งเกณฑ์แล้ว · Threshold set',
  schedule: 'เพิ่มช่องแล้ว · Useful life',
  'life-set': 'ตั้งค่าแล้ว · Useful life 36 months',
  start: 'เพิ่มช่องแล้ว · Start convention',
  'schedule-set': 'ตั้งค่าแล้ว · Start convention',
  categories: 'เพิ่มแล้ว · Asset type settings',
  preview: 'เพิ่มแล้ว · Candidate asset list',
  browse: 'เพิ่มแล้ว · Search and source details',
};
const STAGE_FOCUS: Record<Exclude<DemoDraftStage, null>, string> = {
  threshold: 'draft-threshold',
  'threshold-set': 'draft-threshold',
  schedule: 'draft-useful-life',
  'life-set': 'draft-useful-life',
  start: 'draft-start',
  'schedule-set': 'draft-start',
  categories: 'draft-categories',
  preview: 'draft-preview',
  browse: 'draft-browse',
};
const money = (value: number | null | undefined) => value == null || !Number.isFinite(value)
  ? '—'
  : `฿${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const signedMoney = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const prefix = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${prefix}${money(Math.abs(rounded))}`;
};
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const policyLife = (life: number | null, usesSource: boolean) => usesSource
  ? life == null ? 'Use source register' : `Source · ${life} months`
  : life == null ? 'Not set' : `${life} months`;
const categoryLabel = (category: Category) => category === 'Unknown' ? 'Unknown · review' : category;

function categoryCounts(workspace: Workspace): Record<DraftCategory, number> {
  return CATEGORIES.reduce((counts, category) => {
    counts[category] = workspace.dataset.assets.filter(asset => asset.category === category).length;
    return counts;
  }, {} as Record<DraftCategory, number>);
}

function copyPolicy(policy: Policy): Policy {
  return {
    ...policy,
    laptop: { ...policy.laptop },
    ...(policy.categoryRules ? { categoryRules: Object.fromEntries(Object.entries(policy.categoryRules).map(([key, rule]) => [key, rule ? { ...rule } : rule])) } : {}),
  };
}

function initialCandidate(policy: Policy, instruction?: string, fromGuidedStage = false): Policy {
  if (fromGuidedStage) return copyPolicy(policy);
  const candidate = copyPolicy(policy);
  const text = instruction?.trim().toLocaleLowerCase() ?? '';
  const isPreparedLaptopRequest = text === TEACHING_PROMPT.trim().toLocaleLowerCase()
    || (/\blaptop\b/.test(text) && /\b15(?:,?000)\b/.test(text) && /\b36(?:\s*(?:months?|เดือน))?\b/.test(text));
  if (!isPreparedLaptopRequest) return candidate;
  return {
    ...candidate,
    laptop: { threshold: 15000, usefulLifeMonths: 36, start: 'in-service' },
  };
}

function guidedCandidate(policy: Policy, stage: Exclude<DemoDraftStage, null>): Policy {
  const candidate = copyPolicy(policy);
  if (stage === 'threshold') return candidate;

  candidate.laptop.threshold = 15000;
  if (stage === 'threshold-set') return candidate;
  if (stage === 'schedule') return candidate;

  if (stage === 'life-set' || stage === 'start') {
    candidate.laptop.usefulLifeMonths = 36;
    return candidate;
  }

  candidate.laptop.usefulLifeMonths = 36;
  candidate.laptop.start = 'in-service';
  return candidate;
}

function effectiveValues(policy: Policy, category: DraftCategory, asset?: Asset) {
  if (category === 'Laptop') {
    return {
      threshold: policy.laptop.threshold,
      usefulLifeMonths: policy.laptop.usefulLifeMonths,
      start: policy.laptop.start,
      usesSourceLife: false,
      thresholdSource: 'Laptop policy',
      lifeSource: 'Laptop policy',
      startSource: 'Laptop policy',
    };
  }
  if (category === 'Unknown') return null;
  const rule = policy.categoryRules?.[category];
  const resolved = asset && asset.category === category ? resolveCategoryPolicy(policy, asset) : null;
  return {
    threshold: resolved?.threshold ?? rule?.threshold ?? policy.defaultThreshold,
    usefulLifeMonths: resolved?.usefulLifeMonths ?? rule?.usefulLifeMonths ?? asset?.usefulLifeMonths ?? null,
    start: resolved?.start ?? rule?.start ?? 'following-month' as const,
    usesSourceLife: resolved?.usesSourceLife ?? rule?.usefulLifeMonths === undefined,
    thresholdSource: rule?.threshold === undefined ? 'Shared policy default' : 'Category rule',
    lifeSource: resolved?.usesSourceLife ?? rule?.usefulLifeMonths === undefined ? 'Source register' : 'Category rule',
    startSource: rule?.start === undefined ? 'Default convention' : 'Category rule',
  };
}

function changedOutcome(candidate: ReturnType<typeof reconcile>['rows'][number], active: ReturnType<typeof reconcile>['rows'][number] | undefined) {
  if (!active) return true;
  return cents(candidate.calculated) !== cents(active.calculated)
    || cents(candidate.difference) !== cents(active.difference)
    || candidate.status !== active.status
    || candidate.findings.map(finding => finding.code).join('|') !== active.findings.map(finding => finding.code).join('|');
}

export default function AssetPolicyDraft({ workspace, initialInstruction, propose }: AssetPolicyDraftProps) {
  const demoActive = useWorkspace(state => state.demoActive);
  const demoDraftStage = useWorkspace(state => state.demoDraftStage);
  const guidedStage = demoActive ? demoDraftStage : null;
  const guided = guidedStage !== null;
  const [candidateState, setCandidate] = useState<Policy>(() => initialCandidate(workspace.policy, initialInstruction, guided));
  const candidate = guided && guidedStage ? guidedCandidate(workspace.policy, guidedStage) : candidateState;
  const [baseVersion, setBaseVersion] = useState(workspace.policy.version);
  const [selectedCategoryState, setSelectedCategory] = useState<DraftCategory>('Laptop');
  const [view, setView] = useState<View>('settings');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [searchText, setSearchText] = useState('');
  const [selectedRowId, setSelectedRowId] = useState(workspace.dataset.assets[0]?.rowId ?? '');
  const [thresholdText, setThresholdText] = useState<CategoryText>({});
  const [lifeText, setLifeText] = useState<CategoryText>({});
  const [explicitLifeMode, setExplicitLifeMode] = useState<Partial<Record<RuleCategory, boolean>>>({});
  const [error, setError] = useState('');
  const draftRef = useRef<HTMLDivElement | null>(null);
  const selectedCategory: DraftCategory = guidedStage && guidedStage !== 'categories' && guidedStage !== 'browse'
    ? 'Laptop'
    : selectedCategoryState;
  const shortThresholdStage = guidedStage === 'threshold' || guidedStage === 'threshold-set';
  const showSettings = (!guided || !['preview', 'browse'].includes(guidedStage ?? ''))
    ? view === 'settings'
    : guidedStage === 'browse' && view === 'settings';
  const simplePreview = guidedStage === 'preview';
  const browsingPreview = guidedStage === 'browse' && view === 'assets';
  const manualPreview = !guided && view === 'assets';
  const showPreview = simplePreview || browsingPreview || manualPreview;
  const proposalAvailable = !guided;
  const showCategories = !guided || guidedStage === 'categories' || guidedStage === 'browse';
  const showSchedule = !guided || ['schedule', 'life-set', 'start', 'schedule-set', 'categories', 'browse'].includes(guidedStage ?? '');
  const showStartConvention = !guided || ['start', 'schedule-set', 'categories', 'browse'].includes(guidedStage ?? '');

  useEffect(() => {
    if (demoActive && guidedStage) {
      setView(guidedStage === 'preview' || guidedStage === 'browse' ? 'assets' : 'settings');
      return;
    }
    const shouldPreviewAssets = /หน้ารวม|หน้ารายการ|asset list/i.test(initialInstruction ?? '');
    setView(shouldPreviewAssets ? 'assets' : 'settings');
  }, [demoActive, guidedStage, initialInstruction]);

  useEffect(() => {
    if (!demoActive || !guidedStage) return;
    setThresholdText({});
    setLifeText({});
    setExplicitLifeMode({});
    setSelectedCategory('Laptop');
    setCategoryFilter('All');
    setSearchText('');
    setError('');
  }, [demoActive, guidedStage]);

  useEffect(() => {
    if (!demoActive || !guidedStage) return;
    const root = draftRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-demo-focus="${STAGE_FOCUS[guidedStage]}"]`);
    const scroller = root?.closest<HTMLElement>('.inspector__content');
    if (!target || !scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const badgeHeight = root?.querySelector('.adaptive-ui__stage-badge')?.getBoundingClientRect().height ?? 0;
    const targetTop = scroller.scrollTop + targetRect.top - scrollerRect.top;
    const targetBottom = scroller.scrollTop + targetRect.bottom - scrollerRect.top;
    const visibleTop = targetTop - badgeHeight - 10;
    const visibleBottom = targetBottom - scroller.clientHeight + 8;
    scroller.scrollTo({ top: Math.max(0, Math.min(visibleTop, visibleBottom)), behavior: 'auto' });
  }, [demoActive, guidedStage]);

  const assetCounts = useMemo(() => categoryCounts(workspace), [workspace.dataset.assets]);
  const representativeAsset = workspace.dataset.assets.find(asset => asset.category === selectedCategory);
  const activeValues = effectiveValues(workspace.policy, selectedCategory, representativeAsset);
  const draftValues = effectiveValues(candidate, selectedCategory, representativeAsset);
  const currentRule = selectedCategory === 'Laptop' || selectedCategory === 'Unknown'
    ? undefined
    : candidate.categoryRules?.[selectedCategory];
  const forceExplicitLife = selectedCategory !== 'Laptop' && selectedCategory !== 'Unknown'
    ? explicitLifeMode[selectedCategory] === true
    : false;
  const usesSourceLife = selectedCategory !== 'Laptop' && selectedCategory !== 'Unknown'
    ? (draftValues?.usesSourceLife ?? currentRule?.usefulLifeMonths === undefined) && !forceExplicitLife
    : false;
  const currentThreshold = draftValues?.threshold ?? 0;
  const currentLife = draftValues?.usefulLifeMonths ?? null;
  const thresholdValue = guided ? String(currentThreshold) : thresholdText[selectedCategory] ?? String(currentThreshold);
  const lifeValue = guided
    ? usesSourceLife ? '' : currentLife == null ? '' : String(currentLife)
    : lifeText[selectedCategory] ?? (usesSourceLife ? '' : currentLife == null ? '' : String(currentLife));
  const isUnknown = selectedCategory === 'Unknown';
  const isOtherKnown = selectedCategory === 'Furniture' || selectedCategory === 'Equipment' || selectedCategory === 'Vehicle';
  const hasStaleBase = workspace.policy.version !== baseVersion;

  const activeResult = useMemo(() => reconcile(workspace.dataset, workspace.policy), [workspace.dataset, workspace.policy]);
  const previewResult = useMemo(() => reconcile(workspace.dataset, candidate), [workspace.dataset, candidate]);
  const activeByRow = useMemo(() => new Map(activeResult.rows.map(row => [row.asset.rowId, row])), [activeResult]);
  const changedCount = previewResult.rows.filter(row => changedOutcome(row, activeByRow.get(row.asset.rowId))).length;
  const filteredRows = useMemo(() => previewResult.rows.filter(result => {
    if (categoryFilter !== 'All' && result.asset.category !== categoryFilter) return false;
    const query = searchText.trim().toLowerCase();
    return !query || [result.asset.assetId, result.asset.rowId, result.asset.description, result.asset.category]
      .some(value => value.toLowerCase().includes(query));
  }), [previewResult, categoryFilter, searchText]);
  const selectedRow = filteredRows.find(row => row.asset.rowId === selectedRowId) ?? filteredRows[0];
  const activeSelectedRow = selectedRow ? activeByRow.get(selectedRow.asset.rowId) : undefined;
  const selectedPolicy = selectedRow ? resolveCategoryPolicy(candidate, selectedRow.asset) : null;

  const updateLaptop = (field: keyof Policy['laptop'], value: Policy['laptop'][keyof Policy['laptop']]) => {
    setCandidate(previous => ({ ...previous, laptop: { ...previous.laptop, [field]: value } }));
    setError('');
  };
  const updateOtherCategory = (category: RuleCategory, patch: Partial<CategoryPolicyRule>) => {
    setCandidate(previous => withCategoryPolicy(previous, category, patch));
    setError('');
  };
  const updateThreshold = (value: string) => {
    setThresholdText(previous => ({ ...previous, [selectedCategory]: value }));
    if (value.trim() === '') { setError('Enter a non-negative threshold.'); return; }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) { setError('Enter a non-negative threshold.'); return; }
    if (selectedCategory === 'Laptop') updateLaptop('threshold', numeric);
    else if (isOtherKnown) updateOtherCategory(selectedCategory, { threshold: numeric });
  };
  const updateLife = (value: string) => {
    setLifeText(previous => ({ ...previous, [selectedCategory]: value }));
    if (value.trim() === '') { setError('Enter a whole useful life from 1 to 600 months.'); return; }
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 600) { setError('Enter a whole useful life from 1 to 600 months.'); return; }
    if (selectedCategory === 'Laptop') updateLaptop('usefulLifeMonths', numeric);
    else if (isOtherKnown) updateOtherCategory(selectedCategory, { usefulLifeMonths: numeric });
  };
  const resetDraft = () => {
    setCandidate(copyPolicy(workspace.policy));
    setBaseVersion(workspace.policy.version);
    setThresholdText({});
    setLifeText({});
    setExplicitLifeMode({});
    setError('');
  };
  const toggleSourceLife = (useSourceValue: boolean) => {
    if (!isOtherKnown) return;
    setExplicitLifeMode(previous => ({ ...previous, [selectedCategory]: !useSourceValue }));
    setLifeText(previous => ({ ...previous, [selectedCategory]: useSourceValue ? '' : String(representativeAsset?.usefulLifeMonths ?? '') }));
    updateOtherCategory(selectedCategory, { usefulLifeMonths: useSourceValue ? undefined : representativeAsset?.usefulLifeMonths });
  };
  const setStart = (value: Policy['laptop']['start']) => {
    if (selectedCategory === 'Laptop') updateLaptop('start', value);
    else if (isOtherKnown) updateOtherCategory(selectedCategory, { start: value });
  };
  const restoreSharedThreshold = () => {
    if (!isOtherKnown) return;
    setThresholdText(previous => ({ ...previous, [selectedCategory]: String(candidate.defaultThreshold) }));
    updateOtherCategory(selectedCategory, { threshold: undefined });
  };
  const restoreDefaultStart = () => {
    if (!isOtherKnown) return;
    updateOtherCategory(selectedCategory, { start: undefined });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const instruction = initialInstruction?.trim();
    if (hasStaleBase) { setError('The active policy changed while this draft was open. Reload the current policy before creating a proposal.'); return; }
    if (!instruction) { setError('Write an instruction before creating a rule proposal.'); return; }
    const thresholdNumber = Number(thresholdValue);
    if (!Number.isFinite(thresholdNumber) || thresholdNumber < 0) { setError('Enter a non-negative threshold.'); return; }
    if (!usesSourceLife && (!Number.isInteger(Number(lifeValue)) || Number(lifeValue) < 1 || Number(lifeValue) > 600)) {
      setError('Enter a whole useful life from 1 to 600 months.');
      return;
    }
    if (isUnknown) { setError('Unknown categories need source review before a reusable rule can be created.'); return; }
    if (error) { setError(error); return; }
    propose(copyPolicy(candidate), instruction);
  };
  const simpleRows = previewResult.rows.slice(0, 5);
  const shownRows = simplePreview ? simpleRows : filteredRows;

  return <div ref={draftRef} className={`asset-policy-draft${guided ? ' adaptive-ui--guided' : ''}`} data-testid="asset-policy-draft" data-demo-draft-stage={guidedStage ?? 'manual'}>
    {guidedStage && <div className="adaptive-ui__stage-badge" role="status" aria-live="polite">
      <span>GUIDED DRAFT</span><strong>{STAGE_TITLE[guidedStage]}</strong>
      {STAGE_ADDED[guidedStage] && <small>{STAGE_ADDED[guidedStage]}</small>}
    </div>}
    <header className={`asset-policy-draft__header${guided ? ' asset-policy-draft__header--guided' : ''}`}>
      {guided ? <p className="asset-policy-draft__guided-context" aria-label={`${categoryLabel(selectedCategory)} · ฉบับร่าง`}>{categoryLabel(selectedCategory)} · ฉบับร่าง</p> : <>
      <div className="asset-policy-draft__title-row">
        <span className="asset-policy-draft__icon"><SlidersHorizontal size={16} /></span>
        <div><span className="asset-policy-draft__eyebrow">RULE SETTINGS · DRAFT</span><h3>Asset policy</h3></div>
        <span className="asset-policy-draft__draft-tag">DRAFT</span>
      </div>
      <p>Changes stay here until you create a proposal. Active policy remains unchanged.</p>
      </>}
      {hasStaleBase && <div className="asset-policy-draft__stale" role="alert"><span>The active policy is now v{workspace.policy.version}; this draft started from v{baseVersion}.</span><button type="button" onClick={resetDraft}><RotateCcw size={13} /> Reload active policy</button></div>}
    </header>

    {!guided && <div className="asset-policy-draft__view-tabs" role="tablist" aria-label="Draft view">
      <button type="button" role="tab" aria-selected={view === 'settings'} className={view === 'settings' ? 'is-active' : ''} data-testid="draft-settings" onClick={() => setView('settings')}><SlidersHorizontal size={14} /> Settings</button>
      <button type="button" role="tab" aria-selected={view === 'assets'} className={view === 'assets' ? 'is-active' : ''} data-testid="draft-asset-list" onClick={() => setView('assets')}><Eye size={14} /> Fixed asset preview <span>{previewResult.rows.length}</span></button>
    </div>}

    {showSettings && <>
      {guidedStage === 'browse' && <button type="button" className="adaptive-ui__return" onClick={() => setView('assets')}><Eye size={13} /> Return to asset preview</button>}
      {showCategories && <div className={`asset-policy-draft__category-tabs${guidedStage === 'categories' ? ' adaptive-ui__revealed' : ''}`} role="tablist" aria-label="Asset category" data-demo-focus={guidedStage === 'categories' ? 'draft-categories' : undefined} data-demo-focus-active={guidedStage === 'categories' ? 'true' : undefined}>
        {guidedStage === 'categories' && <span className="adaptive-ui__added-tag">เพิ่มแล้ว · Asset types</span>}
        {CATEGORIES.map(category => <button type="button" role="tab" key={category} aria-selected={selectedCategory === category} className={`${selectedCategory === category ? 'is-active' : ''}${category === 'Unknown' ? ' is-review' : ''}`} onClick={() => { setSelectedCategory(category); setError(''); }}>
          <span>{categoryLabel(category)}</span><small>{assetCounts[category]}</small>
        </button>)}
      </div>}

      {isUnknown ? <section className="asset-policy-draft__review" role="note">
        <span className="asset-policy-draft__review-icon"><FileSearch size={17} /></span>
        <div><strong>Unknown category · review only</strong><p>No reusable rule is applied to unknown categories. Check the source row and assign a known category before teaching behavior.</p></div>
      </section> : <form className={`asset-policy-draft__form${shortThresholdStage ? ' adaptive-ui__focused-form' : ''}`} onSubmit={proposalAvailable ? submit : event => event.preventDefault()}>
        {guided && <p id="guided-policy-readonly-note" className="adaptive-ui__guide-note adaptive-ui__visually-hidden">เดโมนี้แสดงค่าที่เตรียมไว้ · กด “ลองเอง” เพื่อแก้ค่าด้วยตัวเอง</p>}
        <fieldset className="adaptive-ui__fields" disabled={guided} aria-describedby={guided ? 'guided-policy-readonly-note' : undefined}>
        {!shortThresholdStage && <><div className="asset-policy-draft__source-line"><Database size={13} /><span>{selectedCategory === 'Laptop' ? 'Source: active Laptop policy' : representativeAsset ? `Source: ${workspace.dataset.name} · ${representativeAsset.rowId}` : `Source: ${workspace.dataset.name} · no ${selectedCategory.toLowerCase()} rows`}</span></div>
        <div className="asset-policy-draft__active-compare">
          <div><span>Active policy</span><strong>v{workspace.policy.version}</strong></div>
          <ArrowRight size={14} />
          <div><span>Local draft</span><strong>{candidate.version === workspace.policy.version ? `based on v${baseVersion}` : `v${candidate.version}`}</strong></div>
        </div></>}

        <label className={`asset-policy-draft__field${guidedStage === 'threshold-set' ? ' adaptive-ui__revealed' : ''}`} data-demo-focus={shortThresholdStage ? 'draft-threshold' : undefined} data-demo-focus-active={shortThresholdStage ? 'true' : undefined}>
          <span className="asset-policy-draft__field-heading"><span>{selectedCategory === 'Laptop' ? 'Laptop threshold' : `${selectedCategory} threshold`}</span><small>{guidedStage === 'threshold-set' ? 'เพิ่มแล้ว · Threshold set' : selectedCategory === 'Laptop' ? 'Active Laptop rule' : currentRule?.threshold === undefined ? 'Shared default · editable override' : 'Draft category override'}</small></span>
          <span className="asset-policy-draft__money-input"><b>฿</b><input aria-label={selectedCategory === 'Laptop' ? 'Laptop threshold amount' : `${selectedCategory} threshold amount`} type="number" min="0" step="0.01" value={thresholdValue} onChange={event => updateThreshold(event.target.value)} disabled={isUnknown} /></span>
          {isOtherKnown && currentRule?.threshold !== undefined && <button type="button" className="asset-policy-draft__inline-action" onClick={restoreSharedThreshold}>Use shared default · {money(candidate.defaultThreshold)}</button>}
          {activeValues && draftValues && <small className="asset-policy-draft__value-line">Active {money(activeValues.threshold)} <ArrowRight size={11} /> Draft {money(draftValues.threshold)}</small>}
        </label>

        {showSchedule && <div className={`adaptive-ui__schedule-block${guidedStage === 'schedule' || guidedStage === 'life-set' || guidedStage === 'start' || guidedStage === 'schedule-set' ? ' adaptive-ui__revealed' : ''}${guidedStage === 'schedule' || guidedStage === 'life-set' ? ' adaptive-ui__schedule-block--life-only' : ''}`} data-demo-focus={guidedStage === 'schedule' || guidedStage === 'life-set' || guidedStage === 'start' || guidedStage === 'schedule-set' ? 'draft-schedule' : undefined} data-demo-focus-active={guidedStage === 'schedule' ? 'true' : undefined}>
        {(guidedStage === 'schedule' || guidedStage === 'life-set' || guidedStage === 'start' || guidedStage === 'schedule-set') && <span className="adaptive-ui__added-tag">{STAGE_ADDED[guidedStage]}</span>}
        <div className="asset-policy-draft__field" data-demo-focus="draft-useful-life" data-demo-focus-active={guidedStage === 'schedule' || guidedStage === 'life-set' ? 'true' : undefined}>
          <span className="asset-policy-draft__field-heading"><span>Useful life</span><small>{selectedCategory === 'Laptop' ? 'Active Laptop rule' : usesSourceLife ? 'Source-based per asset' : 'Draft category rule'}</small></span>
          {isOtherKnown && <label className="asset-policy-draft__source-life-toggle"><input type="checkbox" checked={usesSourceLife} onChange={event => toggleSourceLife(event.target.checked)} /><span>Use useful life from each asset record</span></label>}
          <span className="asset-policy-draft__life-input"><input aria-label={selectedCategory === 'Laptop' ? 'Laptop useful life' : `${selectedCategory} useful life`} type="number" min="1" max="600" step="1" value={lifeValue} placeholder={usesSourceLife ? representativeAsset ? `${representativeAsset.usefulLifeMonths} months from source` : 'No category record yet' : ''} onChange={event => updateLife(event.target.value)} disabled={isUnknown || usesSourceLife} /><b>months</b></span>
          {selectedCategory === 'Laptop' && activeValues && draftValues && <small className="asset-policy-draft__value-line">Active {policyLife(activeValues.usefulLifeMonths, activeValues.usesSourceLife)} <ArrowRight size={11} /> Draft {policyLife(draftValues.usefulLifeMonths, draftValues.usesSourceLife)}</small>}
          {isOtherKnown && <small className="asset-policy-draft__evidence">{usesSourceLife ? representativeAsset ? `Source register value: ${representativeAsset.usefulLifeMonths} months on ${representativeAsset.rowId}; the rule will preserve each row’s own value.` : 'No source row is available for this category yet. New rows can supply their own useful life.' : 'This fixed useful life applies to each asset in this category.'}</small>}
        </div>

        {showStartConvention && <label className="asset-policy-draft__field" data-demo-focus="draft-start" data-demo-focus-active={guidedStage === 'start' || guidedStage === 'schedule-set' ? 'true' : undefined}>
          <span className="asset-policy-draft__field-heading"><span>Start convention</span><small>{selectedCategory === 'Laptop' ? 'Active Laptop rule' : currentRule?.start === undefined ? 'Default · following month' : 'Draft category override'}</small></span>
          <select aria-label="Start convention" value={selectedCategory === 'Laptop' ? candidate.laptop.start : currentRule?.start ?? 'following-month'} onChange={event => setStart(event.target.value as Policy['laptop']['start'])}>
            <option value="in-service">Month placed in service</option><option value="following-month">Following month</option>
          </select>
          {selectedCategory === 'Laptop' && activeValues && draftValues && <small className="asset-policy-draft__value-line">Active {activeValues.start === 'in-service' ? 'Month placed in service' : 'Following month'} <ArrowRight size={11} /> Draft {draftValues.start === 'in-service' ? 'Month placed in service' : 'Following month'}</small>}
          {isOtherKnown && currentRule?.start !== undefined && <button type="button" className="asset-policy-draft__inline-action" onClick={restoreDefaultStart}>Use default · following month</button>}
        </label>}
        </div>}
        </fieldset>

        {error && <p className="asset-policy-draft__error" role="alert">{error}</p>}
        {proposalAvailable && <><div className="asset-policy-draft__impact-note"><ShieldCheck size={14} /><span>This is a candidate only. The active rule changes only after proposal tests pass and you approve it.</span></div>
        <button className="asset-policy-draft__create" type="submit" data-testid="teach-rule"><GitBranchIcon /> Create rule proposal</button></>}
        {guided && <p className="adaptive-ui__draft-note">The active policy stays unchanged while this draft grows.</p>}
      </form>}
    </>}

    {showPreview && <section className={`asset-policy-draft__preview${simplePreview || browsingPreview ? ' adaptive-ui__revealed' : ''}`} aria-label="Fixed asset list candidate preview" data-preview-stage={simplePreview ? 'preview' : browsingPreview ? 'browse' : 'manual'} data-demo-focus={simplePreview ? 'draft-preview' : undefined} data-demo-focus-active={simplePreview ? 'true' : undefined}>
      <div className="asset-policy-draft__preview-heading"><div><span className="asset-policy-draft__preview-label"><Eye size={13} /> PREVIEW · NOT LIVE</span><h4>Candidate calculations</h4></div><span className="asset-policy-draft__change-count">{changedCount} changed</span></div>
      <p className="asset-policy-draft__preview-note">Calculated with the current asset and ledger rows against this draft. The saved policy and canvas table are unchanged.</p>
      {simplePreview && <span className="adaptive-ui__added-tag">{STAGE_ADDED.preview}</span>}
      {browsingPreview && <span className="adaptive-ui__added-tag">{STAGE_ADDED.browse}</span>}
      {!simplePreview && <div className="adaptive-ui__browse-controls" data-demo-focus={browsingPreview ? 'draft-browse' : undefined} data-demo-focus-active={browsingPreview ? 'true' : undefined}><div className="asset-policy-draft__filter-tabs" role="tablist" aria-label="Filter preview by category">
        <button type="button" role="tab" aria-selected={categoryFilter === 'All'} className={categoryFilter === 'All' ? 'is-active' : ''} onClick={() => setCategoryFilter('All')}>All <small>{previewResult.rows.length}</small></button>
        {CATEGORIES.filter(category => assetCounts[category] > 0).map(category => <button type="button" role="tab" key={category} aria-selected={categoryFilter === category} className={categoryFilter === category ? 'is-active' : ''} onClick={() => setCategoryFilter(category)}>{category}<small>{assetCounts[category]}</small></button>)}
      </div>
      <label className="asset-policy-draft__search"><Search size={14} /><input aria-label="Search preview assets" placeholder="Search ID, description, category" value={searchText} onChange={event => setSearchText(event.target.value)} /></label></div>}
      {shownRows.length ? <>
        <div className="asset-policy-draft__table-wrap"><table className="asset-policy-draft__table">
          <thead><tr><th>Asset</th><th>Category</th><th>Candidate</th></tr></thead>
          <tbody>{shownRows.map(result => <tr key={result.asset.rowId} className={!simplePreview && selectedRow?.asset.rowId === result.asset.rowId ? 'is-selected' : ''}>
            <td><button type="button" onClick={() => !simplePreview && setSelectedRowId(result.asset.rowId)} aria-label={`Inspect preview for ${result.asset.assetId}`}><strong>{result.asset.assetId}</strong><small>{result.asset.description}</small></button></td>
            <td>{result.asset.category}</td><td><strong>{money(result.calculated)}</strong><small>{result.status === 'matched' ? 'Matched' : 'Review'}</small></td>
          </tr>)}</tbody>
        </table></div>
        {!simplePreview && selectedRow && <article className="asset-policy-draft__selected" data-testid="draft-selected-asset">
          <div className="asset-policy-draft__selected-head"><div><span>SELECTED SOURCE ROW</span><h4>{selectedRow.asset.assetId} · {selectedRow.asset.description}</h4></div><span className={`asset-policy-draft__status asset-policy-draft__status--${selectedRow.status}`}>{selectedRow.status === 'matched' ? 'Matched' : 'Review'}</span></div>
          <div className="asset-policy-draft__selected-source"><Database size={12} /> {workspace.dataset.name} · {workspace.dataset.period} · row {selectedRow.asset.rowId}</div>
          <dl className="asset-policy-draft__selected-facts">
            <div><dt>Category / cost</dt><dd>{selectedRow.asset.category} · {money(selectedRow.asset.cost)}</dd></div>
            <div><dt>Source useful life</dt><dd>{selectedRow.asset.usefulLifeMonths} months</dd></div>
            <div><dt>Calculated · active → draft</dt><dd>{money(activeSelectedRow?.calculated)} <ArrowRight size={11} /> {money(selectedRow.calculated)}</dd></div>
            <div><dt>Register / GL</dt><dd>{money(selectedRow.recorded)} / {money(selectedRow.ledgerAmount)}</dd></div>
            <div><dt>Calculated − register</dt><dd>{signedMoney(selectedRow.calculated - selectedRow.recorded)}</dd></div>
            <div><dt>Calculated − GL</dt><dd>{selectedRow.ledgerAmount == null ? 'Unknown · no ledger row' : signedMoney(selectedRow.calculated - selectedRow.ledgerAmount)}</dd></div>
            <div><dt>Rule used</dt><dd>{selectedPolicy ? `${money(selectedPolicy.threshold)} · ${policyLife(selectedPolicy.usefulLifeMonths, selectedPolicy.usesSourceLife)} · ${selectedPolicy.start}` : 'Needs category review'}</dd></div>
          </dl>
          {!!selectedRow.findings.length && <ul className="asset-policy-draft__findings">{selectedRow.findings.map(finding => <li key={finding.code}><ArrowDownRight size={12} /> {finding.message}</li>)}</ul>}
        </article>}
      </> : <div className="asset-policy-draft__empty"><FileSearch size={17} /><strong>{simplePreview ? 'No asset rows to preview' : 'No matching asset rows'}</strong><span>{simplePreview ? 'The workspace has no source asset rows.' : 'Change the category filter or search to see source records.'}</span></div>}
      <div className="asset-policy-draft__preview-footer"><span><Database size={12} /> {simplePreview ? `${shownRows.length} of ${previewResult.rows.length} first-view rows` : `${filteredRows.length} of ${previewResult.rows.length} source rows`}</span>{simplePreview ? <span>Asset list added to the draft</span> : <button type="button" onClick={() => setView('settings')}><SlidersHorizontal size={13} /> Back to settings</button>}</div>
    </section>}
  </div>;
}

function GitBranchIcon() {
  return <ArrowDownRight size={15} aria-hidden="true" />;
}
