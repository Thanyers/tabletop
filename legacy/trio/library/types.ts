import type { ComponentType } from 'react';
import type { CaseId } from '../types';

export type PresentationId = 'original' | 'table' | 'cards' | 'chart';
export type RenderedPresentationId = Exclude<PresentationId, 'original'>;
export type SurfaceState = 'loading' | 'ready' | 'empty' | 'error';
export type SurfaceFieldTone = 'normal' | 'pending' | 'attention';

export interface SurfaceColumn {
  id: string;
  label: string;
}

export interface SurfaceField {
  text: string;
  numericValue?: number | null;
  tone?: SurfaceFieldTone;
}

export interface SurfaceRecord {
  id: string;
  label: string;
  detail?: string;
  fields: Readonly<Record<string, SurfaceField>>;
  measure: number | null;
  measureText: string;
  status?: string;
  statusTone?: SurfaceFieldTone;
}

export interface SurfaceMetric {
  label: string;
  value: string;
  note?: string;
}

export interface SurfaceResolution {
  caseId: CaseId;
  title: string;
  sourceLabel: string;
  derivedLabel: string;
  ruleSummary: string;
  activeVersion: number;
  state: SurfaceState;
  stateMessage?: string;
  columns: readonly SurfaceColumn[];
  records: readonly SurfaceRecord[];
  metrics: readonly SurfaceMetric[];
}

export interface PresentationOption {
  id: PresentationId;
  label: string;
  description: string;
  tradeoff: string;
  recommended: boolean;
  libraryComponent: 'form' | 'table' | 'cards' | 'chart';
}

export interface SurfaceRendererProps {
  surface: SurfaceResolution;
  compact?: boolean;
}

export interface RenderedComponentDefinition {
  kind: RenderedPresentationId;
  label: string;
  description: string;
  component: ComponentType<SurfaceRendererProps>;
}

export interface PreservedFormDefinition {
  kind: 'form';
  label: string;
  description: string;
  source: 'preserved-child';
}

export type SurfaceLibraryDefinition = RenderedComponentDefinition | PreservedFormDefinition;

