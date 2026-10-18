export type TapHand = 'left' | 'right' | 'both';
export type TapJudgment = 'early' | 'on-time' | 'late';

export interface ComponentLabSettings {
  bpm: number;
  toleranceMs: number;
  splitHands: boolean;
  appearance: string;
}

export interface TapHistoryEntry {
  id: string;
  hand: TapHand;
  offsetMs: number;
  at: number;
}

export interface RhythmStateSnapshot {
  settings: ComponentLabSettings;
  history: TapHistoryEntry[];
}

export interface PriorComponent {
  title: string;
  explanation: string;
  html: string;
  css: string;
  js: string;
  settings: ComponentLabSettings;
}

export interface GenerateComponentRequest {
  request: string;
  snapshot: RhythmStateSnapshot;
  prior?: PriorComponent;
  editInstruction?: string;
  editIndex?: number;
}

export interface GeneratedComponent {
  title: string;
  explanation: string;
  html: string;
  css: string;
  js: string;
  settings: ComponentLabSettings;
}

export type GenerationJobState = 'running' | 'complete' | 'failed' | 'cancelled';

export interface ComponentLabJob {
  jobId: string;
  status: GenerationJobState;
  result?: GeneratedComponent & { modelMs: number; modelId: string };
  error?: string;
}

export interface ModelRunResult {
  component: GeneratedComponent;
  modelId: string;
  modelMs: number;
}
