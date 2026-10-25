import type { SourceCue } from './sourceEvidence';
export type CaseId = 'shipping' | 'quest' | 'music';
export type StoryStep = 'sources' | 'minimal' | 'notice' | 'teach' | 'verify' | 'approve' | 'simulate' | 'handoff';
export type BuildPhase = 'typing' | 'thinking' | 'building' | 'reading' | 'complete';
export type CanvasLayout = Partial<Record<StoryStep, {x:number;y:number}>>;
export interface ShippingRule { bangkok: number; regional: number; extraKg: number; effectiveDate: string }
export interface EncounterRule { allyShield: boolean; shieldReduction: number }
export interface QuestRule { firstHint: number; secondHint: number; autoReveal: boolean; encounter?: EncounterRule }
export interface MusicRule { chorusBpm: number; otherBpm: number; repetitions: number }
export interface RuleBook { shipping: ShippingRule; quest: QuestRule; music: MusicRule }
export interface SampleResult { id: string; label: string; input: string; expected: string; actual: string; passed: boolean; reason: string }
export interface Verification { caseId: CaseId; fingerprint: string; cases: SampleResult[]; passed: number; failed: number }
export interface EvidenceEvent { id: string; kind: 'source' | 'instruction' | 'test' | 'approval' | 'run' | 'simulation' | 'handoff'; title: string; detail: string; version: number; at: string; references: string[] }
export interface TrioSnapshot {
 caseId: CaseId; level: number; active: RuleBook; draft: RuleBook; simulation: RuleBook;
 evaluation: Verification | null; version: number; approved: boolean;
 events: EvidenceEvent[]; handoff: 'waiting' | 'in-progress';
 layout?: CanvasLayout;
}
export interface TrioStageProps {
 sourceCue?: SourceCue;
 onSourceInspect?: (purpose: SourceCue['purpose']) => void;
 narrativeAnchor?: string;
 speed?: number;
 surfaceVisible?: boolean;
  onInspect?: (step?: StoryStep) => void;
 snapshot: TrioSnapshot; step: StoryStep; phase: BuildPhase; draftFields: number; guided: boolean; paused: boolean;
 onDraftChange: (book: RuleBook) => void; onSimulationChange: (book: RuleBook) => void;
 onVerify: () => void; onApprove: () => void; onHandoff: () => void;
 onContinue: () => void;
 onFeedback: (detail: string) => void;
}
