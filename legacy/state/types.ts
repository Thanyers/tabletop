import type { Asset, Dataset, Equipment, EquipmentResult, Evaluation, Policy, Reconciliation } from '../domain/types';
import type { SourceConnection } from '../domain/connections';
export type Domain = 'accounting' | 'maintenance';
export type ObjectKind = 'context' | 'source' | 'worker' | 'table' | 'dashboard' | 'exceptions' | 'knowledge' | 'proposal' | 'evaluation' | 'intake' | 'learning' | 'overview';
export type PlacementMode = 'ai' | 'user' | 'pinned';
export type AssetViewStage = 'minimal' | 'comparison' | 'full';
export type DemoDraftStage = 'threshold' | 'threshold-set' | 'schedule' | 'life-set' | 'start' | 'schedule-set' | 'categories' | 'preview' | 'browse' | null;
export type DemoLearningFocus = 'why' | 'approved' | 'experiment' | null;
export interface CanvasObject {
 id: string; type: 'source' | 'view' | 'worker' | 'decision' | 'knowledge' | 'trace'; kind: ObjectKind; title: string;
 position: {x:number;y:number}; width:number; height:number; status: 'ready'|'working'|'needs-review'|'verified';
 configuration: Record<string, unknown>; dataRefs: string[]; dependencies: string[]; version:number; origin:'human'|'system'; executionRef?:string; manuallyArranged?:boolean;
 zIndex?:number; placementMode?:PlacementMode; collapsed?:boolean;
}
export interface TraceEvent {
 id:string; runId:string; taskId:string; workerId:string; workerType:'deterministic'|'human'|'orchestrator';
 title:string; detail:string; inputs:string[]; outputs:string[]; ruleVersion:number; startedAt:string; endedAt:string;
 status:'completed'|'needs-input'|'failed'|'rejected'; error?:string; humanAction?:string; approvalRef?:string;
}
export interface Proposal {
 id:string; before:Policy; candidate:Policy; instruction:string; source:'human'; status:'proposed'|'tested'|'approved'|'rejected';
 createdAt:string; evaluation?:Evaluation; approvalRef?:string;
}
export interface RunSnapshot { id:string; createdAt:string; cause:string; dataset:Dataset; policy:Policy; result:Reconciliation; sourceConnections?:SourceConnection[]; approvalRef?:string; equipmentSnapshot?:Equipment[]; equipmentResults?:EquipmentResult[] }
export interface Incident { id:string; equipmentId:string; description:string; reporter:string; createdAt:string; status:'open'|'resolved' }
export interface Handoff { rowId:string;datasetId?:string;runId?:string; owner:string; status:'waiting'|'in-progress'|'resolved'|'rejected'; attempts:string[] }
export interface Workspace {
 schemaVersion:1;saveSlot?:'sample';sampleOriginDomain?:Domain; domain:Domain; title:string; prompt:string; objects:CanvasObject[]; dataset:Dataset; policy:Policy; versions:Policy[];
 proposals:Proposal[]; activeProposalId:string|null; result:Reconciliation; runs:RunSnapshot[]; events:TraceEvent[]; sourceConnections?:SourceConnection[];
 equipment:Equipment[]; incidents:Incident[]; handoffs:Handoff[]; saved:boolean; savedAt:string|null;
 viewport:{x:number;y:number;zoom:number}; preferences:{hideMatched:boolean}; agentConfiguration:{mode:'deterministic-demo';approvalRequired:true};
}
export type InspectorTarget = {type:'script'|'policy'|'proposal'|'evaluation'|'history'|'help'|'intake'} | {type:'source';initialTab?:'ledger';initialQuery?:string} | {type:'teach';instruction?:string} | {type:'asset'|'handoff';rowId:string};
export interface DraftImport { assets?:Asset[]; ledger?:Dataset['ledger']; assetFilename?:string; ledgerFilename?:string; period?:string }
